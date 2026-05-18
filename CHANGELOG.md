# StockFlow Changelog

All notable changes are documented here. Versions follow `MAJOR.MINOR.PATCH`.

---

## Dashboard v1.0.0 — 2026-05-18

First production-ready release. Covers Phase 1 (core inventory), Phase 2 (operational workflow), and Phase 3 (financial controls).

### Phase 3 — Financial Controls
- **Risk threshold gate** — adjustments exceeding a configurable Rands threshold (default R5,000) require explicit manager acknowledgement before approval
- **Immutable audit ledger** — append-only `auditLedger` Firestore subcollection; entries written on `approval_created`, `approved`, `rejected`, `zoho_synced`
- **Monthly reconciliation report** — date picker, summary cards, full audit table with event-type badges, CSV export

### Phase 2 — Operational Workflow
- **Approval preview modal** — before any approval (single or bulk) shows a table: SKU | Item Name | Expected | Counted | Variance | Unit Cost | Value Impact (R)
- **Required approval comment** — stored permanently as `approvalComment` on the approval document; shown in session drill-down and audit report
- **Session freeze banner** — review phase count inputs become read-only after submission pending approval; amber banner shown

### Bug Fixes
- **Invited user auth flow** — `getUserByEmail` now called after `createUserWithEmailAndPassword` so the user is authenticated when the lookup runs
- **Orphaned Firebase auth** — auth account deleted on Firestore failure so the user can re-sign-up
- **orgName validation** — moved to post-invite-check path; invited users no longer blocked by an orgName requirement
- **Zoho `status: 'draft'` 500 error** — removed unsupported draft status from adjustment payload
- **"Send to Zoho" bypass** — header retry button now shows a confirmation modal instead of executing immediately

### Housekeeping
- Removed debug panels from StockTakeView (yellow test-notification box and allSessions table)
- `approvalComment` and `rejectionReason` displayed in session drill-down modal per item
- Risk threshold configurable in Settings → Stock Take Controls (admin only)
- Firestore composite index added for `auditLedger.timestamp`

---

## APK v1.2.0 — 2026-05-18

- versionCode bumped to 2; versionName to 1.2.0 to align with dashboard Phase 2/3 release
- StockTake screen aligned with dashboard session freeze and approval workflow expectations

---

## APK v1.1.0 — prior release

- Real-time stock take session support via Firebase
- FCM push notifications for session start/end
- Barcode scanning, stock in/out flows

---

## Dashboard v0.0.x — prior releases

- Initial multi-tenant inventory management dashboard
- Zoho Books integration (sync, approvals)
- Firebase auth, Firestore, activity logging
- Purchase orders, supplier management, low stock alerts
