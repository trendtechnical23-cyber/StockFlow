// ============================================================================
// PURCHASE ORDER TYPE DEFINITIONS
// Based on PURCHASE_ORDER_DATA_MODEL.md
// ============================================================================

import { Timestamp } from 'firebase/firestore';

// ============================================================================
// ENUMS
// ============================================================================

export enum POStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SENT = 'sent',
  ACKNOWLEDGED = 'acknowledged',
  READY_TO_SHIP = 'ready_to_ship',
  SHIPPED = 'shipped',
  PARTIALLY_RECEIVED = 'partially_received',
  RECEIVED = 'received',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
  ON_HOLD = 'on_hold'
}

export enum PaymentTerms {
  COD = 'cod',
  NET_7 = 'net_7',
  NET_15 = 'net_15',
  NET_30 = 'net_30',
  NET_60 = 'net_60',
  NET_90 = 'net_90',
  ADVANCE = 'advance',
  CUSTOM = 'custom'
}

export enum PaymentStatus {
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
  PAID = 'paid'
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  NOT_REQUIRED = 'not_required'
}

export enum LineItemStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  RECEIVED = 'received',
  CANCELLED = 'cancelled'
}

export enum EmailType {
  PO_SENT = 'po_sent',
  PO_APPROVED = 'po_approved',
  PO_REJECTED = 'po_rejected',
  PO_ACKNOWLEDGED = 'po_acknowledged',
  DELIVERY_NOTE = 'delivery_note',
  SHIPPING_LABEL = 'shipping_label',
  PO_REMINDER = 'po_reminder',
  PO_CANCELLED = 'po_cancelled'
}

export enum AuditEventType {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  EDITED = 'edited',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SENT = 'sent',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
  ITEM_ADDED = 'item_added',
  ITEM_REMOVED = 'item_removed',
  ITEM_UPDATED = 'item_updated',
  EMAIL_SENT = 'email_sent',
  PAYMENT_UPDATE = 'payment_update'
}

// ============================================================================
// INTERFACES
// ============================================================================

export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface Contact {
  name: string;
  email: string;
  phone: string;
  mobile?: string;
  position?: string;
}

export interface POLineItem {
  lineNumber: number;
  
  // Product Reference
  productId?: string;
  sku?: string;
  barcode?: string;
  
  // Description
  description: string;
  notes?: string;
  
  // Quantities
  quantityOrdered: number;
  quantityReceived: number;
  unit: string; // "EA", "KG", "L", "Box", etc.
  
  // Pricing
  unitPrice: number;
  discountPercentage: number;
  discountAmount: number;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  
  // Delivery
  expectedDeliveryDate?: Date | Timestamp;
  actualDeliveryDate?: Date | Timestamp;
  
  // Status
  status: LineItemStatus;
  isReceived: boolean;
  
  // Verification (from APK)
  scannedQuantity: number;
  verifiedBy?: string;
  verifiedAt?: Date | Timestamp;
  
  // Custodial Tracking (SA Compliance)
  ownerID?: string; // Who owns this item (if not the organization)
  ownerName?: string;
  ownerType?: 'own' | 'customer' | 'supplier' | 'thirdParty';
  
  // Three-Way Match (SA SARS Compliance)
  deliveryNoteNumber?: string; // Links to POD
  taxInvoiceNumber?: string; // Links to supplier invoice
  threeWayMatchStatus?: 'pending' | 'matched' | 'discrepancy' | 'resolved';
  matchedAt?: Date | Timestamp;
  matchedBy?: string;
}

export interface POAttachment {
  id: string;
  filename: string;
  url: string;
  size: number;
  type: string; // MIME type
  uploadedBy: string;
  uploadedAt: Date | Timestamp;
}

export interface EmailLog {
  id: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  type: EmailType;
  sentAt: Date | Timestamp;
  sentBy: string;
  sentByName: string;
  status: 'sent' | 'failed' | 'bounced';
  error?: string;
  opened: boolean;
  openedAt?: Date | Timestamp;
  clicks: number;
  attachmentCount: number;
}

export interface PurchaseOrder {
  // Identification
  id?: string; // Firestore document ID
  poNumber: string;
  organizationId: string;
  source: 'manual' | 'zoho';
  zohoPoId?: string;
  
  // Supplier Information
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  supplierPhone?: string;
  supplierAddress: Address;
  supplierTaxNumber?: string;
  
  // Purchase Order Details
  status: POStatus;
  title: string;
  description?: string;
  referenceNumber?: string;
  
  // Financial Information
  currency: string;
  exchangeRate: number;
  subtotal: number;
  vatAmount: number;
  vatRate: number;
  discountAmount: number;
  discountPercentage: number;
  shippingCost: number;
  otherCharges: number;
  totalAmount: number;
  
  // Payment Terms
  paymentTerms: PaymentTerms;
  paymentTermsDays?: number;
  paymentDueDate?: Date | Timestamp;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  
  // Important Dates
  issueDate: Date | Timestamp;
  expectedDeliveryDate?: Date | Timestamp;
  deliveryDate?: Date | Timestamp;
  approvalDate?: Date | Timestamp;
  sentDate?: Date | Timestamp;
  closedDate?: Date | Timestamp;
  
  // Line Items
  lineItems: POLineItem[];
  
  // Approval Workflow
  approvalRequired: boolean;
  approvalStatus: ApprovalStatus;
  approvedBy?: string;
  approvedByName?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectionReason?: string;
  
  // Delivery Information
  deliveryAddress: Address;
  deliveryInstructions?: string;
  deliveryNoteId?: string;
  
  // Shipping Information
  shippingMethod?: string;
  trackingNumber?: string;
  shippingLabelId?: string;
  
  // System Fields
  createdBy: string;
  createdByName: string;
  createdAt: Date | Timestamp;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Date | Timestamp;
  
  // Flags
  isActive: boolean;
  isSynced: boolean;
  lastSyncAt?: Date | Timestamp;
  
  // Attachments
  attachments: POAttachment[];
  
  // Notes
  internalNotes?: string;
  supplierNotes?: string;
  
  // Email History
  emailsSent: EmailLog[];
}

export interface Supplier {
  // Basic Information
  id?: string;
  supplierId?: string;
  supplierCode?: string;
  name: string;
  tradingAs?: string;
  
  // Contact Information
  primaryContact: Contact;
  alternateContacts: Contact[];
  
  // Business Details
  taxNumber?: string;
  registrationNumber?: string;
  website?: string;
  industry?: string;
  
  // Address
  billingAddress: Address;
  shippingAddress: Address;
  sameAsBilling: boolean;
  
  // Financial
  defaultCurrency: string;
  defaultPaymentTerms: PaymentTerms;
  creditLimit?: number;
  currentBalance: number;
  
  // Banking
  bankDetails?: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    branchCode: string;
    swiftCode?: string;
  };
  
  // Ratings & Performance
  rating?: number;
  totalPurchases: number;
  totalOrders: number;
  onTimeDeliveryRate: number;
  
  // System Fields
  isActive: boolean;
  createdBy: string;
  createdByName?: string;
  createdAt: Date | Timestamp;
  updatedAt: Date | Timestamp;
  
  // Zoho Integration
  zohoVendorId?: string;
  isSyncedWithZoho: boolean;
  lastSyncAt?: Date | Timestamp;
  
  // Tags & Categories
  tags: string[];
  category?: string;
}

export interface DeliveryNote {
  // Identification
  id?: string;
  deliveryNoteNumber: string; // Must match POD from supplier
  purchaseOrderId: string;
  poNumber: string; // SA SARS: PO number must be on POD for VAT claim
  organizationId: string;
  
  // Delivery Information
  deliveryDate: Date | Timestamp;
  receivedBy: string;
  receivedByName: string;
  receivedBySignature?: string; // Electronic signature for SARS
  
  // Items Delivered
  items: {
    lineNumber: number;
    description: string;
    quantityOrdered: number;
    quantityDelivered: number;
    unit: string;
    // Custodial tracking
    ownerID?: string;
    ownerName?: string;
  }[];
  
  // Verification (APK Scanning)
  scannedItems: {
    barcode: string;
    scannedAt: Date | Timestamp;
    scannedBy: string;
    quantity: number;
  }[];
  verificationComplete: boolean;
  discrepancies: {
    lineNumber: number;
    issue: string;
    expectedQuantity: number;
    actualQuantity: number;
  }[];
  
  // Condition Assessment
  itemsInGoodCondition: boolean;
  damageNotes?: string;
  damagePhotos?: string[];
  
  // PDF Generation
  pdfUrl?: string;
  pdfGeneratedAt?: Date | Timestamp;
  
  // System Fields
  createdBy: string;
  createdByName: string;
  createdAt: Date | Timestamp;
  updatedAt: Date | Timestamp;
}

export interface ShippingLabel {
  // Identification
  id?: string;
  labelNumber: string;
  purchaseOrderId: string;
  deliveryNoteId?: string;
  organizationId: string;
  
  // Shipping Details
  fromAddress: Address;
  toAddress: Address;
  
  // Package Information
  packageType: string;
  weight: number;
  dimensions: {
    length: number;
    width: number;
    height: number;
    unit: string;
  };
  
  // Courier Information
  courierService?: string;
  trackingNumber?: string;
  estimatedDeliveryDate?: Date | Timestamp;
  
  // Contents Summary
  items: {
    description: string;
    quantity: number;
  }[];
  
  // Barcode/QR Code
  barcodeData: string;
  qrCodeUrl?: string;
  
  // PDF Generation
  pdfUrl?: string;
  pdfGeneratedAt?: Date | Timestamp;
  
  // System Fields
  createdBy: string;
  createdByName: string;
  createdAt: Date | Timestamp;
}

export interface TaxInvoice {
  // Identification - SA SARS Compliant
  id?: string;
  taxInvoiceNumber: string; // From supplier (must say "Tax Invoice")
  purchaseOrderId: string;
  poNumber: string; // SA SARS: PO number must be on Tax Invoice
  organizationId: string;
  
  // Supplier Information (SA SARS Requirements)
  supplierName: string;
  supplierVATNumber: string; // Required for VAT invoices
  supplierAddress: Address;
  supplierTaxNumber?: string;
  
  // Recipient Information
  recipientName: string;
  recipientVATNumber?: string; // Required if amount > R5,000
  recipientAddress: Address;
  
  // Invoice Details
  invoiceDate: Date | Timestamp;
  dueDate?: Date | Timestamp;
  currency: string;
  
  // Line Items (must match delivery)
  items: {
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    discountPercentage: number;
    discountAmount: number;
    subtotal: number;
    vatRate: number; // 15% standard in SA
    vatAmount: number;
    total: number;
    // Link to PO line item
    poLineNumber?: number;
  }[];
  
  // Financial Totals (SA SARS: Must show breakdown)
  subtotal: number;
  totalDiscount: number;
  totalVAT: number;
  shippingCost: number;
  otherCharges: number;
  grandTotal: number;
  
  // Three-Way Match Status
  deliveryNoteNumber?: string; // Links to POD
  threeWayMatchStatus: 'pending' | 'matched' | 'discrepancy' | 'resolved';
  matchedAt?: Date | Timestamp;
  matchedBy?: string;
  matchDiscrepancies?: {
    description: string;
    expectedValue: any;
    actualValue: any;
  }[];
  
  // Payment Information
  paymentStatus: 'unpaid' | 'partial' | 'paid' | 'overdue';
  amountPaid: number;
  paymentDate?: Date | Timestamp;
  paymentReference?: string;
  
  // Document Storage (SA SARS: 5-year retention)
  attachmentUrl?: string; // Link to PDF of supplier's invoice
  uploadedAt?: Date | Timestamp;
  uploadedBy?: string;
  
  // Verification
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: Date | Timestamp;
  verificationNotes?: string;
  
  // System Fields
  createdBy: string;
  createdByName: string;
  createdAt: Date | Timestamp;
  updatedAt: Date | Timestamp;
}

export interface POAuditLog {
  id?: string;
  eventType: AuditEventType;
  eventDescription: string;
  timestamp: Date | Timestamp;
  
  // User Information
  userId: string;
  userName: string;
  userEmail: string;
  userRole?: string;
  
  // Changes Made
  changes: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  
  // Context
  ipAddress?: string;
  userAgent?: string;
  location?: string;
  
  // Additional Data
  metadata?: Record<string, any>;
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface CurrencyConfig {
  code: string;
  symbol: string;
  name: string;
  decimalPlaces: number;
  isBaseCurrency: boolean;
}

export interface ExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: Date | Timestamp;
  source: string;
}

// ============================================================================
// DISPLAY LABELS
// ============================================================================

export const POStatusLabels: Record<POStatus, string> = {
  [POStatus.DRAFT]: 'Draft',
  [POStatus.PENDING_APPROVAL]: 'Pending Approval',
  [POStatus.APPROVED]: 'Approved',
  [POStatus.REJECTED]: 'Rejected',
  [POStatus.SENT]: 'Sent to Supplier',
  [POStatus.ACKNOWLEDGED]: 'Acknowledged',
  [POStatus.READY_TO_SHIP]: 'Ready to Ship',
  [POStatus.SHIPPED]: 'Shipped',
  [POStatus.PARTIALLY_RECEIVED]: 'Partially Received',
  [POStatus.RECEIVED]: 'Received',
  [POStatus.CLOSED]: 'Closed',
  [POStatus.CANCELLED]: 'Cancelled',
  [POStatus.ON_HOLD]: 'On Hold'
};

export const PaymentTermsLabels: Record<PaymentTerms, string> = {
  [PaymentTerms.COD]: 'Cash on Delivery',
  [PaymentTerms.NET_7]: 'Net 7 Days',
  [PaymentTerms.NET_15]: 'Net 15 Days',
  [PaymentTerms.NET_30]: 'Net 30 Days',
  [PaymentTerms.NET_60]: 'Net 60 Days',
  [PaymentTerms.NET_90]: 'Net 90 Days',
  [PaymentTerms.ADVANCE]: 'Advance Payment',
  [PaymentTerms.CUSTOM]: 'Custom Terms'
};

export const PaymentStatusLabels: Record<PaymentStatus, string> = {
  [PaymentStatus.UNPAID]: 'Unpaid',
  [PaymentStatus.PARTIAL]: 'Partially Paid',
  [PaymentStatus.PAID]: 'Paid'
};

// ============================================================================
// STATUS COLORS (for UI)
// ============================================================================

export const POStatusColors: Record<POStatus, string> = {
  [POStatus.DRAFT]: 'gray',
  [POStatus.PENDING_APPROVAL]: 'yellow',
  [POStatus.APPROVED]: 'green',
  [POStatus.REJECTED]: 'red',
  [POStatus.SENT]: 'blue',
  [POStatus.ACKNOWLEDGED]: 'cyan',
  [POStatus.READY_TO_SHIP]: 'purple',
  [POStatus.SHIPPED]: 'indigo',
  [POStatus.PARTIALLY_RECEIVED]: 'orange',
  [POStatus.RECEIVED]: 'teal',
  [POStatus.CLOSED]: 'gray',
  [POStatus.CANCELLED]: 'red',
  [POStatus.ON_HOLD]: 'yellow'
};

// ============================================================================
// SUPPORTED CURRENCIES
// ============================================================================

export const SupportedCurrencies: CurrencyConfig[] = [
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', decimalPlaces: 2, isBaseCurrency: true },
  { code: 'USD', symbol: '$', name: 'US Dollar', decimalPlaces: 2, isBaseCurrency: false },
  { code: 'EUR', symbol: '€', name: 'Euro', decimalPlaces: 2, isBaseCurrency: false },
  { code: 'GBP', symbol: '£', name: 'British Pound', decimalPlaces: 2, isBaseCurrency: false },
];

// ============================================================================
// WORKFLOW TRANSITIONS
// ============================================================================

export const AllowedStatusTransitions: Record<POStatus, POStatus[]> = {
  [POStatus.DRAFT]: [POStatus.PENDING_APPROVAL, POStatus.APPROVED, POStatus.CANCELLED],
  [POStatus.PENDING_APPROVAL]: [POStatus.APPROVED, POStatus.REJECTED, POStatus.DRAFT, POStatus.CANCELLED],
  [POStatus.REJECTED]: [POStatus.DRAFT, POStatus.CANCELLED],
  [POStatus.APPROVED]: [POStatus.SENT, POStatus.CANCELLED],
  [POStatus.SENT]: [POStatus.ACKNOWLEDGED, POStatus.READY_TO_SHIP, POStatus.ON_HOLD, POStatus.CANCELLED],
  [POStatus.ACKNOWLEDGED]: [POStatus.READY_TO_SHIP, POStatus.ON_HOLD, POStatus.CANCELLED],
  [POStatus.READY_TO_SHIP]: [POStatus.SHIPPED, POStatus.ON_HOLD, POStatus.CANCELLED],
  [POStatus.SHIPPED]: [POStatus.PARTIALLY_RECEIVED, POStatus.RECEIVED, POStatus.ON_HOLD],
  [POStatus.PARTIALLY_RECEIVED]: [POStatus.RECEIVED, POStatus.CLOSED],
  [POStatus.RECEIVED]: [POStatus.CLOSED],
  [POStatus.ON_HOLD]: [POStatus.SENT, POStatus.ACKNOWLEDGED, POStatus.READY_TO_SHIP, POStatus.CANCELLED],
  [POStatus.CLOSED]: [],
  [POStatus.CANCELLED]: []
};
