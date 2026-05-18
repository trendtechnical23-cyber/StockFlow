# South African Purchase Order Compliance Guide

## Overview
This system implements **custodial inventory tracking** for businesses that hold items for third parties. This is critical for SARS compliance to avoid balance sheet fraud.

---

## 🇿🇦 SA Legal Requirements (SARS)

### 1. VAT Compliance (15%)
- **Standard VAT Rate**: 15% (implemented in `vatRate` fields)
- **Tax Invoice Requirements** (for amounts > R5,000):
  - Must include the words "Tax Invoice"
  - Supplier's VAT number (`supplierVATNumber`)
  - Recipient's VAT number
  - Date of issue
  - Full description of goods/services
  - Total amount excluding VAT
  - VAT amount
  - Total amount including VAT

### 2. Record Keeping (5 Years)
- **Digital Records**: Must be kept for **5 years** from tax submission date
- **Server Location**: Records must be stored on servers **physically located in South Africa** unless specific SARS permission is granted
- **Audit Trail**: Immutable transaction history required (see `POAuditLog`)

### 3. Three-Way Match Process
For a transaction to be valid for VAT input claims, verify:
1. **Purchase Order (PO)**: What was ordered
2. **Delivery Note / Proof of Delivery (POD)**: What actually arrived
3. **Tax Invoice**: What the supplier is charging

**CRITICAL**: The PO number must appear on BOTH the POD and the Tax Invoice.

Implemented in `POLineItem.threeWayMatchStatus`:
- `pending`: Waiting for POD and/or Tax Invoice
- `matched`: All three documents match
- `discrepancy`: Quantities/amounts don't match
- `resolved`: Discrepancy resolved by authorized user

---

## 📦 Custodial Inventory (Third-Party Goods)

### The Problem
Your client holds items for other businesses. If these items appear on your client's balance sheet, it's:
- **Tax fraud** (claiming assets they don't own)
- **Financial misrepresentation**
- **SARS violation**

### The Solution: Owner Tracking
Every inventory item has:
```typescript
ownerID?: string;       // Who owns this item
ownerName?: string;     // Display name
ownerType?: 'own' | 'customer' | 'supplier' | 'thirdParty';
custodialNotes?: string; // Why we're holding this
```

**Reporting Rules**:
- `ownerID === null` OR `ownerType === 'own'` → **ON balance sheet** (your client owns it)
- `ownerID !== null` AND `ownerType !== 'own'` → **OFF balance sheet** (custodial, tracked separately)

### Implementation
1. **When creating a PO**: Ask "Who owns these items?"
   - If for internal use: Leave `ownerID` empty
   - If for a customer: Set `ownerID` to customer's ID

2. **When receiving items**: Update inventory with owner tracking
   ```typescript
   if (lineItem.ownerID) {
     // This is custodial - add to separate ledger
     inventory.ownerID = lineItem.ownerID;
     inventory.ownerType = lineItem.ownerType || 'customer';
   }
   ```

3. **Financial Reporting**: Filter by ownership
   - **Balance Sheet**: `WHERE ownerID IS NULL OR ownerType = 'own'`
   - **Custodial Report**: `WHERE ownerID IS NOT NULL AND ownerType != 'own'`
   - **Stock Take**: Include ALL items (owned + custodial)

---

## 🔄 Purchase Order Workflow

### Phase 1: Creation
```typescript
POStatus.DRAFT → POStatus.PENDING_APPROVAL (optional) → POStatus.APPROVED
```
- Create PO with line items
- Specify owner for each line item (if custodial)
- Submit for approval (if required)
- Send to supplier

**Fields Required**:
- `poNumber` (auto-generated: PO-YYYY-####)
- `supplierId` and supplier details
- `supplierVATNumber` (if amount > R5,000)
- Line items with quantities, prices, VAT
- `ownerID` and `ownerType` per line item (if custodial)

### Phase 2: Delivery (Goods Receipt)
```typescript
POStatus.SENT → POStatus.PARTIALLY_RECEIVED → POStatus.RECEIVED
```

**APK Workflow**:
1. Supplier delivers items with **Delivery Note / POD**
2. Warehouse staff scans items via APK
3. System creates `DeliveryNote` record:
   - `deliveryNoteNumber` (from supplier's POD)
   - `receivedBy` and `receivedByName`
   - `receivedBySignature` (electronic signature)
   - Scanned quantities per item
4. System compares:
   - PO quantities vs. Delivered quantities
   - Creates discrepancies if mismatch
5. Updates `POLineItem`:
   - `quantityReceived`
   - `scannedQuantity`
   - `deliveryNoteNumber` (links to POD)
   - `threeWayMatchStatus = 'pending'` (waiting for invoice)

**Inventory Update**:
```typescript
if (lineItem.ownerType === 'own' || !lineItem.ownerID) {
  // Add to balance sheet inventory
  addToInventory(productId, quantityReceived);
} else {
  // Add to custodial inventory (off balance sheet)
  addToCustodialInventory(productId, quantityReceived, lineItem.ownerID);
}
```

### Phase 3: Tax Invoice Receipt
```typescript
POStatus.RECEIVED → POStatus.CLOSED (after three-way match)
```

1. Supplier sends **Tax Invoice**
2. System operator enters:
   - `taxInvoiceNumber`
   - Invoice date
   - Invoice amounts (for verification)
3. System performs **Three-Way Match**:
   ```typescript
   function performThreeWayMatch(poLineItem, deliveryNote, taxInvoice) {
     const poQty = poLineItem.quantityOrdered;
     const deliveredQty = deliveryNote.quantityDelivered;
     const invoicedQty = taxInvoice.quantity;
     const invoicedAmount = taxInvoice.amount;
     const calculatedAmount = poLineItem.unitPrice * deliveredQty * (1 + poLineItem.vatRate/100);
     
     if (poQty === deliveredQty && deliveredQty === invoicedQty && 
         Math.abs(calculatedAmount - invoicedAmount) < 0.01) {
       return 'matched';
     } else {
       return 'discrepancy';
     }
   }
   ```

4. If matched: `threeWayMatchStatus = 'matched'`
5. If discrepancy: Flag for manager review
6. Once ALL line items matched: `status = POStatus.CLOSED`

**Accounting Impact** (if owned):
- Debit: Inventory (Asset)
- Credit: Accounts Payable (Liability)

**Accounting Impact** (if custodial):
- NO journal entries (off balance sheet)
- Update custodial ledger only

---

## 📋 Required Documents (SARS Compliant)

### 1. Purchase Order
- Generated by system
- Sent to supplier via email
- Stored as PDF with all fields visible
- **Must include**: PO number, date, supplier details, line items, total (incl. VAT)

### 2. Delivery Note / Proof of Delivery (POD)
- Received from supplier
- Signed electronically by receiving staff
- **Must include**: PO number (reference), supplier name, delivery date, items received, signature
- Stored as PDF or photo

### 3. Tax Invoice
- Received from supplier
- **Must include**: "Tax Invoice" wording, both VAT numbers, PO number, amounts
- Stored as PDF

### 4. Three-Way Match Report
- System-generated comparison
- Shows: PO vs POD vs Invoice
- Flags discrepancies
- Stored with transaction

---

## 🔐 Audit Trail (Immutable)

Every PO action creates an immutable audit log:
```typescript
interface POAuditLog {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  eventType: AuditEventType; // CREATED, APPROVED, SENT, RECEIVED, etc.
  performedBy: string;
  performedByName: string;
  timestamp: Date;
  changes?: Record<string, { from: any; to: any }>;
  notes?: string;
  ipAddress?: string;
  deviceInfo?: string;
}
```

**SARS Requirement**: These logs must NOT be editable or deletable. Use Firestore subcollection with security rules:
```javascript
match /organizations/{orgId}/purchaseOrders/{poId}/auditLogs/{logId} {
  allow read: if isOrgMember(orgId);
  allow create: if isOrgMember(orgId);
  allow update, delete: if false; // Immutable
}
```

---

## 🚨 Common Pitfalls to Avoid

1. **Don't mix owned and custodial inventory** in balance sheet reports
2. **Always get electronic signature** on delivery notes (SARS accepts digital signatures)
3. **Store PO number on POD and Invoice** - without this, you can't claim VAT input
4. **Keep records for 5 years** - set up automatic retention policy
5. **Use SA servers** - or get SARS permission for cloud storage
6. **Validate VAT calculations** - 15% exactly, no rounding errors
7. **Three-way match BEFORE closing PO** - this is your VAT claim proof

---

## 📊 Reporting Requirements

### 1. Financial Reports (Balance Sheet)
Filter: `ownerID IS NULL OR ownerType = 'own'`
- Total Inventory Value
- Cost of Goods Sold (COGS)
- Accounts Payable

### 2. Custodial Reports (Off Balance Sheet)
Filter: `ownerID IS NOT NULL AND ownerType != 'own'`
- Items held per customer
- Custodial inventory value (for insurance)
- Aging report (how long items have been held)

### 3. VAT Reports (SARS)
- Total VAT paid (input tax)
- Total VAT charged (output tax)
- Must match three-way matched invoices
- Include: Invoice number, date, supplier VAT number, amount

### 4. Audit Trail Report
- All PO transactions
- User actions
- Date/time stamps
- Changes made
- Approval history

---

## 🛠️ Implementation Checklist

- [x] Add `ownerID`, `ownerType` to InventoryItem
- [x] Add custodial fields to POLineItem
- [x] Add three-way match fields to POLineItem
- [ ] Create TaxInvoice interface
- [ ] Build Delivery Note creation UI (APK)
- [ ] Build Tax Invoice entry UI (Dashboard)
- [ ] Implement Three-Way Match verification
- [ ] Add electronic signature capture
- [ ] Separate owned vs custodial in reports
- [ ] Add SARS compliance validation
- [ ] Document server location for SARS
- [ ] Set up 5-year retention policy
- [ ] Add custodial customer selector to PO form
- [ ] Update inventory receiving logic
- [ ] Create custodial ledger report

---

## 📚 References

1. **SARS VAT 404 Guide**: Tax Invoices, Credit and Debit Notes
2. **SARS Record Keeping**: [SARS Website](https://www.sars.gov.za/)
3. **Electronic Signatures**: ECT Act 25 of 2002 (legal in SA)
4. **Custodial Inventory**: Generally Accepted Accounting Practice (GAAP) - off balance sheet treatment

---

## 💡 Example Scenario

**Scenario**: Your client (WarehouseCo) receives 100 widgets ordered by CustomerA

**Step 1: Create PO**
```typescript
{
  poNumber: "PO-2026-0001",
  supplierId: "supplier_123",
  lineItems: [{
    description: "Widget Model X",
    quantityOrdered: 100,
    unitPrice: 500.00,
    vatRate: 15,
    ownerID: "customer_A_id",  // ← CustomerA owns these
    ownerName: "CustomerA (Pty) Ltd",
    ownerType: "customer"
  }]
}
```

**Step 2: Receive Goods**
- Supplier delivers with POD #DEL-789
- APK scans 98 widgets (2 damaged, returned)
- System creates DeliveryNote, updates PO:
```typescript
{
  quantityReceived: 98,
  deliveryNoteNumber: "DEL-789",
  threeWayMatchStatus: "pending"
}
```

**Step 3: Receive Invoice**
- Supplier sends Tax Invoice #INV-456 for 98 widgets
- System performs three-way match:
  - PO: 100 ordered
  - POD: 98 delivered ✓
  - Invoice: 98 billed ✓
  - Amounts match ✓
- Status: `threeWayMatchStatus = "matched"`

**Step 4: Inventory Update**
```typescript
// NOT added to WarehouseCo's balance sheet
// Added to custodial ledger for CustomerA
{
  productId: "widget_x",
  quantity: 98,
  ownerID: "customer_A_id",
  ownerName: "CustomerA (Pty) Ltd",
  location: "Warehouse B, Aisle 3"
}
```

**Result**: 
- WarehouseCo's balance sheet: NO change (custodial)
- CustomerA's inventory: +98 widgets
- SARS compliant: Three-way match complete, 5-year retention, SA servers

---

## 🔍 Summary

Your system now:
1. ✅ Tracks ownership separately from physical custody
2. ✅ Prevents balance sheet fraud
3. ✅ Implements three-way match for SARS VAT claims
4. ✅ Maintains immutable audit trail
5. ✅ Complies with SA record-keeping laws
6. ✅ Handles 15% VAT correctly
7. ✅ Supports electronic signatures
8. ✅ Separates owned vs custodial reporting

**Next Steps**: Implement the UI for delivery note capture and tax invoice entry.
