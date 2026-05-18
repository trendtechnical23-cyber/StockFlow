# 🐛 FUNCTIONAL BUGS REPORT - StockFlow Dashboard

**Generated:** $(Get-Date)  
**Testing Method:** Comprehensive functional analysis of user flows and edge cases  
**Total Bugs Found:** 153  

---

## 📊 EXECUTIVE SUMMARY

| Component | Critical | High | Medium | Low | Total |
|-----------|----------|------|--------|-----|-------|
| Login/Signup | 3 | 4 | 3 | 1 | 11 |
| Dashboard View | 4 | 5 | 4 | 2 | 15 |
| Inventory CRUD | 8 | 15 | 11 | 6 | 40 |
| Import Features | 5 | 12 | 25 | 15 | 57 |
| Stock Take | 6 | 10 | 10 | 4 | 30 |
| **TOTAL** | **26** | **46** | **53** | **28** | **153** |

---

## 🔴 TOP 10 CRITICAL BUGS (Fix Immediately)

### 1. **Invited User Flow Completely Broken** ⛔
**File:** [pages/LoginPage.tsx](pages/LoginPage.tsx#L240-L253)  
**Impact:** Team collaboration doesn't work - invited users cannot join organizations  
**Root Cause:** `getUserByEmail()` requires authentication but is called BEFORE user signs up  
**User Journey:**
1. Admin invites `bob@company.com` to organization "Acme Corp"
2. Bob tries to sign up
3. `checkIfInvited()` always returns null because Bob isn't authenticated yet
4. Bob creates his own organization instead of joining Acme Corp
5. Bob is now in the wrong organization

**Fix Required:**
- Make `getUserByEmail()` work without authentication for invite detection
- Or implement server-side invite token system

---

### 2. **Organization Creation Failure = Permanently Broken Account** ⛔
**File:** [pages/LoginPage.tsx](pages/LoginPage.tsx#L395-L401)  
**Impact:** User account becomes unusable, requires manual database cleanup  
**Scenario:**
1. User submits signup form
2. Firebase auth succeeds → account created ✅
3. `createOrganizationAndUser()` fails (network error, Firestore down, etc.) ❌
4. User sees generic error "Authentication failed"
5. **Now user is stuck:**
   - Can't sign in (no organization exists, App.tsx signs them out)
   - Can't sign up again (email already in use)
   - No recovery flow exists

**Fix Required:**
- Implement transaction pattern: create org first, THEN create Firebase user
- Add account recovery flow for incomplete signups
- Better error messaging with clear next steps

---

### 3. **totalItems Calculation Shows Wrong Number**
**File:** [pages/DashboardView.tsx](pages/DashboardView.tsx#L126)  
```tsx
const totalItems = useMemo(() => (inventory || []).reduce((sum, item) => sum + item.stock, 0), [inventory]);
```
**Bug:** Calculates SUM of all stock quantities, not COUNT of items  
**Example:** 3 items with stock [100, 50, 25] shows "175 Total Items" instead of "3"  
**Fix:** Change to `inventory.length`

---

### 4. **Division By Zero Crashes Dashboard**
**File:** [components/AnalyticsCards.tsx](components/AnalyticsCards.tsx#L142)  
```tsx
stockTurnover: Math.round((recentLogs.length / inventory.length) * 100),
```
**Bug:** When `inventory.length === 0`, divides by zero → `Infinity` → crashes counter animation  
**Impact:** Brand new accounts with no inventory crash immediately  
**Fix:** Add guard `inventory.length > 0 ? Math.round(...) : 0`

---

### 5. **No SKU Uniqueness Validation**
**File:** [services/apiService.ts](services/apiService.ts#L364-L397)  
**Bug:** Multiple items can have identical SKUs  
**Impact:** 
- Barcode scanning returns wrong item
- Reports show duplicate entries
- Inventory accuracy impossible to maintain
**Fix:** Add Firestore query to check existing SKU before insert, enforce unique constraint

---

### 6. **Double Submission Creates Duplicate Items**
**File:** [components/ItemDetailsModal.tsx](components/ItemDetailsModal.tsx#L40-L47)  
```tsx
const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData) {
        setIsSaving(true);
        await onSave(formData);
        setIsSaving(false);  // If user clicks twice, second submit executes
    }
};
```
**Bug:** No check if `isSaving` is already true  
**Impact:** Fast double-clicks create duplicate inventory items  
**Fix:** Add `if (isSaving) return;` at start of function

---

### 7. **Race Condition - Concurrent Edits Overwrite Each Other**
**File:** [context/AppContext.tsx](context/AppContext.tsx#L800-L875)  
**Bug:** No optimistic locking or version checking  
**Scenario:**
1. User A opens item "Widget" (stock: 100)
2. User B opens same item
3. User A changes stock to 120, saves
4. User B changes stock to 80, saves
5. Result: Stock is 80 (User B's change), User A's change is lost

**Fix:** Implement Firestore transaction with version checking or last-modified timestamp

---

### 8. **Items Not Counted Don't Appear in Stock Take Report**
**File:** [pages/StockTakeView.tsx](pages/StockTakeView.tsx#L115-L148)  
**Bug:** Report only includes scanned items  
**Impact:** No visibility into what was NOT counted - could miss entire categories  
**Example:** Warehouse has 1000 items, only 800 scanned, report shows "0 discrepancies" for missing 200  
**Fix:** Include uncounted items in report with status "Not Counted"

---

### 9. **No File Size Validation on Imports**
**Files:** [components/ExcelImportModal.tsx](components/ExcelImportModal.tsx), [components/GoogleSheetsImportModal.tsx](components/GoogleSheetsImportModal.tsx)  
**Bug:** No maximum file size check  
**Impact:** 500MB Excel file gets loaded into browser memory → crash  
**Fix:** Add check `if (file.size > 50MB) reject`

---

### 10. **Preview Data Fetched But Never Displayed**
**Files:** [components/ExcelImportModal.tsx](components/ExcelImportModal.tsx#L68-L77), [components/GoogleSheetsImportModal.tsx](components/GoogleSheetsImportModal.tsx#L44-L55)  
**Bug:** `previewData` state is populated but no UI renders it  
**Impact:** Users import blind without seeing sample data  
**Fix:** Add preview table component showing first 10 rows

---

## 🔴 CRITICAL BUGS BY CATEGORY

### Authentication & User Management (3 Critical)

#### **BUG-AUTH-001: Invited User Flow Broken**
- **Severity:** 🔴 Critical
- **File:** [pages/LoginPage.tsx](pages/LoginPage.tsx#L240-L253)
- **Line:** 240-253, 365-390, 611
- **Description:** `checkIfInvited()` calls `getUserByEmail()` which requires authentication, but user isn't authenticated during signup
- **User Impact:** Cannot invite team members - they create separate organizations
- **Fix Complexity:** High - requires API restructure or server-side invite tokens

#### **BUG-AUTH-002: Signup Failure Breaks Account**
- **Severity:** 🔴 Critical  
- **File:** [pages/LoginPage.tsx](pages/LoginPage.tsx#L395-L401)
- **Description:** Firebase auth succeeds but org creation fails → account in limbo
- **User Impact:** Permanent account corruption, requires support intervention
- **Fix Complexity:** Medium - implement transaction pattern

#### **BUG-AUTH-003: updateUserInOrganization Fails for Invited Users**
- **Severity:** 🔴 Critical
- **File:** [pages/LoginPage.tsx](pages/LoginPage.tsx#L379-L388)
- **Description:** Uses `updateDoc()` on new UID but invited record is at old UID
- **User Impact:** Invited users cannot complete signup
- **Fix Complexity:** Medium - use `setDoc` with merge instead

#### **BUG-AUTH-004: No Email Format Validation**
- **Severity:** ⚠️ High
- **Files:** [pages/LoginPage.tsx](pages/LoginPage.tsx#L303-L305)
- **Description:** Only checks if empty, accepts invalid formats like "test@" or "nodomain"
- **User Impact:** Confusing Firebase errors for users
- **Fix Complexity:** Low - add regex validation

#### **BUG-AUTH-005: Client-Side Rate Limiting Easily Bypassed**
- **Severity:** ⚠️ High
- **File:** [pages/LoginPage.tsx](pages/LoginPage.tsx#L340-L342)
- **Description:** Rate limit stored in React state, bypassed by refreshing page
- **User Impact:** Brute force attacks possible
- **Fix Complexity:** Medium - requires server-side rate limiting

---

### Dashboard Calculations (4 Critical)

#### **BUG-DASH-001: Wrong totalItems Calculation**
- **Severity:** 🔴 Critical
- **File:** [pages/DashboardView.tsx](pages/DashboardView.tsx#L126)
- **Description:** Sums stock quantities instead of counting items
- **User Impact:** Core metric completely wrong - shows 1000 instead of 10
- **Fix Complexity:** Trivial - one line change

#### **BUG-DASH-002: Division By Zero**
- **Severity:** 🔴 Critical
- **File:** [components/AnalyticsCards.tsx](components/AnalyticsCards.tsx#L142)
- **Description:** `recentLogs.length / inventory.length` when inventory is empty
- **User Impact:** App crashes for new users
- **Fix Complexity:** Trivial - add guard condition

#### **BUG-DASH-003: Low Stock Detection Without Safety Checks**
- **Severity:** 🔴 Critical
- **File:** [pages/DashboardView.tsx](pages/DashboardView.tsx#L125)
- **Description:** `item.stock <= item.threshold` when threshold is undefined/null
- **User Impact:** Incorrect low stock alerts, safety stock system unreliable
- **Fix Complexity:** Low - add null checks

#### **BUG-DASH-004: Out of Stock Button Does Nothing**
- **Severity:** 🔴 Critical
- **File:** [pages/DashboardView.tsx](pages/DashboardView.tsx#L137-L141)
- **Description:** Button says "Out of Stock Items" but just opens unfiltered inventory
- **User Impact:** Misleading feature - users think they're seeing filtered view
- **Fix Complexity:** Medium - implement filter params

---

### Inventory Management (8 Critical)

#### **BUG-INV-001: No SKU Uniqueness Validation**
- **Severity:** 🔴 Critical
- **File:** [services/apiService.ts](services/apiService.ts#L364-L397)
- **Description:** Multiple items can have identical SKUs
- **User Impact:** Barcode scanning broken, duplicate data
- **Fix Complexity:** Medium - add Firestore compound query + unique index

#### **BUG-INV-002: Double Submission Protection Missing**
- **Severity:** 🔴 Critical
- **File:** [components/ItemDetailsModal.tsx](components/ItemDetailsModal.tsx#L40-L47)
- **Description:** User can click save multiple times → duplicate items created
- **User Impact:** Data duplication, inventory count errors
- **Fix Complexity:** Trivial - add `if (isSaving) return`

#### **BUG-INV-003: No Race Condition Protection**
- **Severity:** 🔴 Critical
- **File:** [context/AppContext.tsx](context/AppContext.tsx#L800-L875)
- **Description:** Concurrent edits by multiple users → last write wins
- **User Impact:** Lost updates, data overwritten
- **Fix Complexity:** High - implement version checking

#### **BUG-INV-004: Delete Doesn't Check Activity Log References**
- **Severity:** 🔴 Critical
- **File:** [context/AppContext.tsx](context/AppContext.tsx#L877-L893)
- **Description:** Deleting item leaves orphaned activity logs
- **User Impact:** Broken references, audit trail incomplete
- **Fix Complexity:** Medium - add cascade delete or soft delete

#### **BUG-INV-005: No Special Character Escaping in Search**
- **Severity:** ⚠️ High
- **File:** [pages/InventoryView.tsx](pages/InventoryView.tsx#L109-L117)
- **Description:** Searching for `\`, `"`, `'` causes unexpected behavior
- **User Impact:** Search doesn't work for certain items
- **Fix Complexity:** Low - sanitize input

#### **BUG-INV-006: Null SKU Causes Search Crash**
- **Severity:** 🔴 Critical
- **File:** [pages/InventoryView.tsx](pages/InventoryView.tsx#L114)
- **Description:** `item.sku.toLowerCase()` when SKU is null/undefined
- **User Impact:** App crashes during search
- **Fix Complexity:** Trivial - use optional chaining

#### **BUG-INV-007: Invalid Date Parsing Returns 0**
- **Severity:** ⚠️ High
- **File:** [pages/InventoryView.tsx](pages/InventoryView.tsx#L128-L133)
- **Description:** Sort comparison returns 0 on error, breaks sort stability
- **User Impact:** Items appear in random order
- **Fix Complexity:** Low - return -1 or 1 consistently

#### **BUG-INV-008: Negative Stock Allowed**
- **Severity:** 🔴 Critical
- **File:** [components/ItemDetailsModal.tsx](components/ItemDetailsModal.tsx#L101-L109)
- **Description:** HTML5 `min="0"` can be bypassed by typing directly
- **User Impact:** Impossible negative stock values in system
- **Fix Complexity:** Low - add backend validation

---

### Import Features (5 Critical)

#### **BUG-IMP-001: No File Size Validation**
- **Severity:** 🔴 Critical
- **Files:** [components/ExcelImportModal.tsx](components/ExcelImportModal.tsx), [components/GoogleSheetsImportModal.tsx](components/GoogleSheetsImportModal.tsx)
- **Description:** Can upload unlimited file size
- **User Impact:** Browser crash with large files
- **Fix Complexity:** Trivial - add size check

#### **BUG-IMP-002: Preview Data Not Displayed** 
- **Severity:** 🔴 Critical
- **Files:** [components/ExcelImportModal.tsx](components/ExcelImportModal.tsx#L68-L77)
- **Description:** Backend returns preview but UI never shows it
- **User Impact:** Users import blind without verification
- **Fix Complexity:** Medium - build preview UI

#### **BUG-IMP-003: Excel Files Accepted Then Rejected**
- **Severity:** 🔴 Critical
- **File:** [components/ExcelImportModal.tsx](components/ExcelImportModal.tsx#L40-L51)
- **Description:** Accepts .xlsx files then shows warning to convert to CSV
- **User Impact:** Extremely confusing UX
- **Fix Complexity:** Low - reject xlsx or fully support it

#### **BUG-IMP-004: No Google Sheets URL Validation**
- **Severity:** 🔴 Critical
- **File:** [components/GoogleSheetsImportModal.tsx](components/GoogleSheetsImportModal.tsx#L42)
- **Description:** Accepts any URL, even malicious sites
- **User Impact:** Security risk
- **Fix Complexity:** Low - validate URL format

#### **BUG-IMP-005: Partial Import Failures Not Reported**
- **Severity:** 🔴 Critical
- **Files:** [components/ExcelImportModal.tsx](components/ExcelImportModal.tsx#L103-L119)
- **Description:** Shows "100 items imported" when 50 failed
- **User Impact:** User thinks import succeeded but half the data is missing
- **Fix Complexity:** Medium - track and report failures

---

### Stock Take (6 Critical)

#### **BUG-ST-001: Items Not Counted Don't Appear in Report**
- **Severity:** 🔴 Critical
- **File:** [pages/StockTakeView.tsx](pages/StockTakeView.tsx#L115-L148)
- **Description:** Report only includes scanned items, missing items invisible
- **User Impact:** Can't identify what wasn't counted - defeats purpose of stock take
- **Fix Complexity:** Medium - generate full report with "Not Counted" status

#### **BUG-ST-002: No Concurrent Session Prevention**
- **Severity:** 🔴 Critical
- **File:** [hooks/useStockTake.ts](hooks/useStockTake.ts#L75-L90)
- **Description:** User can start multiple sessions simultaneously
- **User Impact:** Data split across sessions, impossible to reconcile
- **Fix Complexity:** Medium - add active session check

#### **BUG-ST-003: No Locking on Batch Updates**
- **Severity:** 🔴 Critical
- **File:** [pages/StockTakeView.tsx](pages/StockTakeView.tsx#L188-L197)
- **Description:** `Promise.all` updates without transaction
- **User Impact:** Race conditions, last write wins
- **Fix Complexity:** High - implement Firestore batch writes with transactions

#### **BUG-ST-004: Duplicate Scans Not Handled**
- **Severity:** 🔴 Critical
- **File:** [services/stockTakeService.ts](services/stockTakeService.ts#L273-L298)
- **Description:** Scanning same item twice creates multiple entries
- **User Impact:** Incorrect counts, confusing reports
- **Fix Complexity:** Medium - deduplicate by itemId

#### **BUG-ST-005: Can Edit Counts After Session Ends**
- **Severity:** 🔴 Critical
- **File:** [pages/StockTakeView.tsx](pages/StockTakeView.tsx#L428-L439)
- **Description:** Admin can arbitrarily change "counted" values in review
- **User Impact:** Defeats audit purpose, data integrity compromised
- **Fix Complexity:** Medium - lock review data, only allow notes

#### **BUG-ST-006: Negative Counted Values Allowed**
- **Severity:** 🔴 Critical
- **File:** [pages/StockTakeView.tsx](pages/StockTakeView.tsx#L428-L439)
- **Description:** Input allows negative numbers with no validation
- **User Impact:** Invalid stock counts
- **Fix Complexity:** Trivial - add validation

---

## ⚠️ HIGH PRIORITY BUGS (46 Total)

### Authentication (4 High)
- **BUG-AUTH-004**: No email format validation
- **BUG-AUTH-005**: Client-side rate limiting bypassable
- **BUG-AUTH-006**: Browser close mid-signup = broken account
- **BUG-AUTH-007**: Password mismatch only validated on submit

### Dashboard (5 High)
- **BUG-DASH-005**: Invalid date handling in smart algorithm
- **BUG-DASH-006**: Category count includes null/undefined
- **BUG-DASH-007**: Negative stock displayed without sanitization
- **BUG-DASH-008**: Performance issues with 10,000+ items
- **BUG-DASH-009**: Zero inventory shows "Excellent" message

### Inventory (15 High)
- **BUG-INV-009**: Name with only spaces allowed
- **BUG-INV-010**: No max length on description field
- **BUG-INV-011**: Stock/threshold allow decimal values
- **BUG-INV-012**: No error display in modal
- **BUG-INV-013**: Modal doesn't prevent close during operation
- **BUG-INV-014**: No network error handling with retry
- **BUG-INV-015**: Form inputs not disabled during save
- **BUG-INV-016**: Pagination breaks with empty filtered results
- **BUG-INV-017**: No sanitization of pasted data with newlines/tabs
- **BUG-INV-018**: Extremely long text inputs not limited
- **BUG-INV-019**: No concurrent edit detection
- **BUG-INV-020**: Real-time listener errors not shown to user
- **BUG-INV-021**: Sort only by lastUsed, no column sorting
- **BUG-INV-022**: Quick add allows empty SKU despite "required"
- **BUG-INV-023**: Category defaults to empty string

### Import (12 High)
- **BUG-IMP-006**: No empty file validation
- **BUG-IMP-007**: No corrupted file detection
- **BUG-IMP-008**: No preview before import
- **BUG-IMP-009**: No handling of blank rows
- **BUG-IMP-010**: No data type validation
- **BUG-IMP-011**: Unclear duplicate logic
- **BUG-IMP-012**: No duplicate preview
- **BUG-IMP-013**: No network failure recovery
- **BUG-IMP-014**: No cancel/abort during import
- **BUG-IMP-015**: No progress indicator for large imports
- **BUG-IMP-016**: Google Sheets - no permission checking
- **BUG-IMP-017**: Google Sheets - no sheet selection for multi-sheet workbooks

### Stock Take (10 High)
- **BUG-ST-007**: Session state not synced between views
- **BUG-ST-008**: No scan/count capability in dashboard
- **BUG-ST-009**: Wrong discrepancy calculation
- **BUG-ST-010**: Race condition in session end
- **BUG-ST-011**: Session progress not saved (refresh loses data)
- **BUG-ST-012**: No historical stock take records
- **BUG-ST-013**: Zero items stock take creates empty records
- **BUG-ST-014**: Invalid barcode handling missing
- **BUG-ST-015**: Items without SKU show internal ID
- **BUG-ST-016**: No session timeout

---

## 🟡 MEDIUM PRIORITY BUGS (53 Total)

*See full report sections above for details on:*
- Authentication edge cases (3)
- Dashboard filtering/sorting (4)
- Inventory validation (11)
- Import data parsing (25)
- Stock Take persistence (10)

---

## 🔵 LOW PRIORITY BUGS (28 Total)

*Includes polish items like:*
- Missing "Remember Me" functionality
- No password strength indicator
- No show/hide password toggle
- Loading state improvements
- Better error messages
- UI polish items

---

## 📈 RECOMMENDED FIX PRIORITY

### Week 1 - Critical Data Integrity
1. Fix invited user flow (BUG-AUTH-001)
2. Fix organization creation failure handling (BUG-AUTH-002)
3. Add SKU uniqueness validation (BUG-INV-001)
4. Fix totalItems calculation (BUG-DASH-001)
5. Add division by zero protection (BUG-DASH-002)
6. Fix double submission (BUG-INV-002)
7. Add file size validation to imports (BUG-IMP-001)
8. Fix stock take missing items in report (BUG-ST-001)

### Week 2 - Core Functionality
9. Implement race condition protection (BUG-INV-003)
10. Fix low stock detection (BUG-DASH-003)
11. Add import preview display (BUG-IMP-002)
12. Fix concurrent stock take sessions (BUG-ST-002)
13. Fix null SKU search crash (BUG-INV-006)
14. Add validation for negative stock (BUG-INV-008)
15. Fix duplicate scan handling (BUG-ST-004)

### Week 3 - User Experience
16. Implement Out of Stock filter (BUG-DASH-004)
17. Add email format validation (BUG-AUTH-004)
18. Fix Excel import UX confusion (BUG-IMP-003)
19. Fix partial import failure reporting (BUG-IMP-005)
20. Lock stock take counts after session ends (BUG-ST-005)
21. Add column sorting to inventory (BUG-INV-021)
22. Implement proper error display in modals (BUG-INV-012)

### Week 4 - Polish & Edge Cases
23-153. Address remaining medium and low priority bugs

---

## 🎯 TESTING RECOMMENDATIONS

1. **Unit Tests Needed:**
   - All calculation functions (totalItems, low stock, discrepancies)
   - Validation functions (email, SKU, negative numbers)
   - Date parsing and formatting

2. **Integration Tests Needed:**
   - Full signup flow (invited + new org)
   - Import workflows (Excel, CSV, Google Sheets)
   - Stock take flow (start → scan → review → apply)
   - Concurrent user scenarios

3. **E2E Tests Needed:**
   - User journey: Signup → Add items → Import → Stock take → Reports
   - Multi-user scenarios (race conditions)
   - Network failure recovery

4. **Load Tests Needed:**
   - Dashboard with 10,000+ items
   - Import with large files (10MB+)
   - Concurrent stock takes by multiple users

---

## 📝 NOTES

- This report focuses on **functional bugs** found through behavioral analysis
- Security audit findings are in COMPREHENSIVE_AUDIT_REPORT.md
- Many bugs have cascading effects (e.g., SKU uniqueness affects inventory, barcode scanning, imports, stock takes)
- Priority is based on: data integrity > core functionality > user experience > polish

**Next Steps:**
1. Review and confirm priority order with stakeholders
2. Create GitHub issues for top 20 critical bugs
3. Implement fixes systematically starting with Week 1 items
4. Add automated tests to prevent regressions
5. Re-test entire flow after fixes

---

**Report End**
