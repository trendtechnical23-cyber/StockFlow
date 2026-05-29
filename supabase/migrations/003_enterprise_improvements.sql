-- ================================================================
-- StockFlow Enterprise Improvements v3.0
-- Builds on top of 002_enterprise_schema.sql
--
-- Changes:
--   1.  Permission-based auth — replaces is_manager_or_owner() role checks
--   2.  organization_settings — structured columns instead of raw JSONB
--   3.  Soft delete — deleted_at / deleted_by on operational tables
--   4.  Idempotency keys — prevents APK retry duplicates
--   5.  movement_types table — replaces rigid ENUM
--   6.  Notification split — notification_events + notification_recipients
--   7.  device_sessions — APK/device management
--   8.  suppliers + purchase_orders foundation
--   9.  Partitioning infrastructure + covering indexes
--  10.  Update all RPC functions + RLS policies
-- ================================================================

-- ================================================================
-- 1. PERMISSION-BASED AUTH
--    Replace role-string checks with user_has_permission(key).
--    is_manager_or_owner() becomes a thin wrapper so existing
--    backend code continues working without immediate rewrites.
-- ================================================================

-- Core permission check: looks up the calling user's role → permissions
CREATE OR REPLACE FUNCTION user_has_permission(p_permission TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users          u
    JOIN role_permissions rp ON rp.role_id       = u.role_id
    JOIN permissions      p  ON p.id             = rp.permission_id
    WHERE u.id   = auth.uid()
      AND p.key  = p_permission
  )
$$;

-- Bridge: keep is_manager_or_owner() but route through permissions
-- This keeps the backend auth middleware working without changes
CREATE OR REPLACE FUNCTION is_manager_or_owner()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT user_has_permission('approvals.review')
$$;

-- ================================================================
-- 2. ORGANIZATION SETTINGS — STRUCTURED TABLE
--    Core config as typed columns (validatable, indexable).
--    Truly dynamic integration data stays in organizations.integrations JSONB.
-- ================================================================

CREATE TABLE IF NOT EXISTS organization_settings (
  org_id                      UUID    PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  currency_code               TEXT    NOT NULL DEFAULT 'ZAR',
  timezone                    TEXT    NOT NULL DEFAULT 'Africa/Johannesburg',
  low_stock_notifications     BOOLEAN NOT NULL DEFAULT TRUE,
  barcode_format              TEXT    NOT NULL DEFAULT 'CODE128'
                              CHECK (barcode_format IN ('CODE128','EAN13','QR','CUSTOM')),
  default_location_id         UUID    REFERENCES inventory_locations(id) ON DELETE SET NULL,
  require_approval_for_adj    BOOLEAN NOT NULL DEFAULT TRUE,
  stock_take_require_approval BOOLEAN NOT NULL DEFAULT TRUE,
  allow_negative_stock        BOOLEAN NOT NULL DEFAULT FALSE,
  low_stock_threshold         INTEGER NOT NULL DEFAULT 10 CHECK (low_stock_threshold >= 0),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_org_isolation" ON organization_settings
  FOR ALL USING (org_id = get_my_org_id());

-- Migrate any existing orgs to have a settings row
INSERT INTO organization_settings (org_id)
SELECT id FROM organizations
ON CONFLICT (org_id) DO NOTHING;

-- ================================================================
-- 3. SOFT DELETE
--    Operational records are NEVER hard-deleted.
--    is_active is kept alongside for fast boolean reads.
-- ================================================================

-- inventory_items
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by  UUID REFERENCES users(id) ON DELETE SET NULL;

-- inventory_locations
ALTER TABLE inventory_locations
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by  UUID REFERENCES users(id) ON DELETE SET NULL;

-- users (deactivated members — never hard-deleted)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by  UUID REFERENCES users(id) ON DELETE SET NULL;

-- Helper: soft-delete an inventory item (updates is_active + deleted_at atomically)
CREATE OR REPLACE FUNCTION rpc_soft_delete_item(p_item_id UUID, p_deleted_by UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE inventory_items
  SET is_active  = FALSE,
      deleted_at = NOW(),
      deleted_by = p_deleted_by
  WHERE id = p_item_id
    AND org_id = get_my_org_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found or access denied', p_item_id;
  END IF;
END;
$$;

-- ================================================================
-- 4. IDEMPOTENCY KEYS
--    Prevents duplicate movements / approval requests from APK retries
--    on flaky South African mobile networks.
--    Client generates a UUID per operation before sending.
-- ================================================================

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Unique within an org — one org cannot have two movements with same key
CREATE UNIQUE INDEX IF NOT EXISTS idx_movements_idempotency
  ON stock_movements(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_idempotency
  ON approval_requests(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE stock_take_entries
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ste_idempotency
  ON stock_take_entries(session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ================================================================
-- 5. MOVEMENT_TYPES TABLE — replaces rigid ENUM
--    System types are seeded below. Orgs can add custom types later.
--    stock_movements.movement_type stays as TEXT code for readability;
--    movement_type_id FK enables joins and org-specific overrides.
-- ================================================================

CREATE TABLE IF NOT EXISTS movement_types (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL org_id = global system type; UUID = org-specific custom type
  org_id      UUID    REFERENCES organizations(id) ON DELETE CASCADE,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  -- 'in' = increases stock, 'out' = decreases stock, 'neutral' = recount
  direction   TEXT    NOT NULL CHECK (direction IN ('in','out','neutral')),
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE NULLS NOT DISTINCT (org_id, code)
);

ALTER TABLE movement_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "movement_types_read" ON movement_types
  FOR SELECT USING (org_id IS NULL OR org_id = get_my_org_id());

CREATE POLICY "movement_types_managers_write" ON movement_types
  FOR ALL USING (
    org_id = get_my_org_id()
    AND user_has_permission('settings.manage')
  );

-- Seed system-level movement types (org_id = NULL = global)
INSERT INTO movement_types (org_id, code, name, direction, is_system, sort_order) VALUES
  (NULL, 'OPENING_BALANCE',  'Opening Balance',           'in',      TRUE,  1),
  (NULL, 'RECEIVE',          'Stock Receipt',             'in',      TRUE,  2),
  (NULL, 'SALE',             'Sale / Issue',              'out',     TRUE,  3),
  (NULL, 'TRANSFER_IN',      'Transfer In',               'in',      TRUE,  4),
  (NULL, 'TRANSFER_OUT',     'Transfer Out',              'out',     TRUE,  5),
  (NULL, 'ADJUSTMENT_IN',    'Adjustment (Add)',          'in',      TRUE,  6),
  (NULL, 'ADJUSTMENT_OUT',   'Adjustment (Remove)',       'out',     TRUE,  7),
  (NULL, 'DAMAGE',           'Damage / Write-off',        'out',     TRUE,  8),
  (NULL, 'RETURN_IN',        'Customer Return',           'in',      TRUE,  9),
  (NULL, 'RETURN_OUT',       'Supplier Return',           'out',     TRUE, 10),
  (NULL, 'STOCKTAKE_GAIN',   'Stock Take Gain',           'in',      TRUE, 11),
  (NULL, 'STOCKTAKE_LOSS',   'Stock Take Loss',           'out',     TRUE, 12)
ON CONFLICT (org_id, code) DO NOTHING;

-- Add movement_type_id FK to stock_movements
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS movement_type_id UUID REFERENCES movement_types(id);

-- Backfill movement_type_id from code (for any existing rows)
UPDATE stock_movements sm
SET movement_type_id = mt.id
FROM movement_types mt
WHERE mt.code    = sm.movement_type::TEXT
  AND mt.org_id IS NULL
  AND sm.movement_type_id IS NULL;

-- Index
CREATE INDEX IF NOT EXISTS idx_movements_type_id ON stock_movements(movement_type_id);

-- ================================================================
-- 6. NOTIFICATION SPLIT
--    notification_events  = the event (one per action)
--    notification_recipients = per-user delivery state
--
--    Benefits:
--      ✓ Per-user read/push tracking
--      ✓ Multiple channels: FCM, email, SMS, WhatsApp
--      ✓ Digest queries: "all unread for user X"
--      ✓ Push-sent flag prevents double-send on retry
-- ================================================================

-- Drop old monolithic table (no production data yet)
DROP TABLE IF EXISTS notifications CASCADE;

-- Event: the thing that happened
CREATE TABLE notification_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user delivery state
CREATE TABLE notification_recipients (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID    NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  org_id      UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  push_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  dismissed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

-- Indexes
CREATE INDEX idx_notif_events_org_date    ON notification_events(org_id, created_at DESC);
CREATE INDEX idx_notif_recip_user_unread  ON notification_recipients(user_id, is_read, created_at DESC);
CREATE INDEX idx_notif_recip_event        ON notification_recipients(event_id);
CREATE INDEX idx_notif_recip_push_unsent  ON notification_recipients(user_id, push_sent)
  WHERE push_sent = FALSE;

-- RLS
ALTER TABLE notification_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_events_org_read"    ON notification_events
  FOR SELECT USING (org_id = get_my_org_id());

-- Users see only their own recipient rows
CREATE POLICY "notif_recip_own"          ON notification_recipients
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notif_recip_mark_read"    ON notification_recipients
  FOR UPDATE USING (user_id = auth.uid());

-- Inserts come from SECURITY DEFINER functions (bypass RLS)

-- Helper: create an event + fan out to specific users
CREATE OR REPLACE FUNCTION fn_notify_users(
  p_org_id   UUID,
  p_user_ids UUID[],
  p_type     TEXT,
  p_title    TEXT,
  p_body     TEXT,
  p_data     JSONB DEFAULT '{}'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO notification_events (org_id, type, title, body, data)
  VALUES (p_org_id, p_type, p_title, p_body, p_data)
  RETURNING id INTO v_event_id;

  INSERT INTO notification_recipients (event_id, org_id, user_id)
  SELECT v_event_id, p_org_id, unnest(p_user_ids)
  ON CONFLICT (event_id, user_id) DO NOTHING;

  RETURN v_event_id;
END;
$$;

-- Helper: create an event + fan out to ALL active org members
CREATE OR REPLACE FUNCTION fn_notify_org(
  p_org_id UUID,
  p_type   TEXT,
  p_title  TEXT,
  p_body   TEXT,
  p_data   JSONB DEFAULT '{}'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO notification_events (org_id, type, title, body, data)
  VALUES (p_org_id, p_type, p_title, p_body, p_data)
  RETURNING id INTO v_event_id;

  INSERT INTO notification_recipients (event_id, org_id, user_id)
  SELECT v_event_id, p_org_id, u.id
  FROM users u
  WHERE u.org_id = p_org_id
    AND u.status = 'active'
    AND u.deleted_at IS NULL
  ON CONFLICT (event_id, user_id) DO NOTHING;

  RETURN v_event_id;
END;
$$;

-- Helper: notify all managers in an org
CREATE OR REPLACE FUNCTION fn_notify_managers(
  p_org_id UUID,
  p_type   TEXT,
  p_title  TEXT,
  p_body   TEXT,
  p_data   JSONB DEFAULT '{}'
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO notification_events (org_id, type, title, body, data)
  VALUES (p_org_id, p_type, p_title, p_body, p_data)
  RETURNING id INTO v_event_id;

  INSERT INTO notification_recipients (event_id, org_id, user_id)
  SELECT v_event_id, p_org_id, u.id
  FROM users u
  WHERE u.org_id     = p_org_id
    AND u.legacy_role IN ('owner','manager')
    AND u.status     = 'active'
    AND u.deleted_at IS NULL
  ON CONFLICT (event_id, user_id) DO NOTHING;

  RETURN v_event_id;
END;
$$;

-- ================================================================
-- 7. DEVICE SESSIONS
--    Tracks every active device independently from FCM tokens.
--    Enables: remote logout, APK version monitoring, online status.
-- ================================================================

CREATE TABLE device_sessions (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id       TEXT    NOT NULL,
  platform        TEXT    NOT NULL DEFAULT 'android'
                  CHECK (platform IN ('android','ios','web')),
  app_version     TEXT,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address      INET,
  is_online       BOOLEAN NOT NULL DEFAULT FALSE,
  push_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id)
);

CREATE INDEX idx_device_sessions_user    ON device_sessions(user_id);
CREATE INDEX idx_device_sessions_org     ON device_sessions(org_id);
CREATE INDEX idx_device_sessions_online  ON device_sessions(org_id, is_online)
  WHERE is_online = TRUE;

ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;

-- Users see only their own devices
CREATE POLICY "device_sessions_own"         ON device_sessions
  FOR ALL USING (user_id = auth.uid());

-- Managers can see all devices in org (for device management)
CREATE POLICY "device_sessions_managers"    ON device_sessions
  FOR SELECT USING (
    org_id = get_my_org_id()
    AND user_has_permission('users.manage')
  );

-- ================================================================
-- 8. SUPPLIERS + PURCHASE ORDERS FOUNDATION
-- ================================================================

CREATE TABLE suppliers (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT,
  account_number TEXT,
  payment_terms TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID    REFERENCES users(id),
  metadata      JSONB   NOT NULL DEFAULT '{}',
  created_by    UUID    REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

CREATE TABLE purchase_orders (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id      UUID    REFERENCES suppliers(id) ON DELETE SET NULL,
  reference_number TEXT,
  status           TEXT    NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','partial','received','cancelled')),
  ordered_at       TIMESTAMPTZ,
  expected_at      TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  notes            TEXT,
  created_by       UUID    NOT NULL REFERENCES users(id),
  approved_by      UUID    REFERENCES users(id),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID    REFERENCES users(id),
  metadata         JSONB   NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_order_lines (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   UUID    NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id             UUID    NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity_ordered    NUMERIC(12,4) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received   NUMERIC(12,4) NOT NULL DEFAULT 0
                      CHECK (quantity_received >= 0),
  unit_cost           NUMERIC(12,2),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_suppliers_org           ON suppliers(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_po_org_status           ON purchase_orders(org_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_po_supplier             ON purchase_orders(supplier_id);
CREATE INDEX idx_pol_order               ON purchase_order_lines(purchase_order_id);
CREATE INDEX idx_pol_item                ON purchase_order_lines(item_id);

-- Triggers
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_po_updated_at
  BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- RLS
ALTER TABLE suppliers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_org"            ON suppliers
  FOR ALL USING (org_id = get_my_org_id());

CREATE POLICY "po_org"                   ON purchase_orders
  FOR ALL USING (org_id = get_my_org_id());

CREATE POLICY "pol_via_order"            ON purchase_order_lines
  FOR ALL USING (
    purchase_order_id IN (
      SELECT id FROM purchase_orders WHERE org_id = get_my_org_id()
    )
  );

-- ================================================================
-- 9. PARTITIONING INFRASTRUCTURE
--    stock_movements will be the largest table.
--    We add covering indexes now for partition-like query performance.
--    Declarative partitioning should be applied before data exceeds
--    ~5M rows — at that point, recreate the table as PARTITION BY RANGE(created_at).
--
--    Covering indexes below allow index-only scans on the most
--    common query patterns, deferring full partitioning.
-- ================================================================

-- Covering index: org + date range queries (most common dashboard query)
CREATE INDEX IF NOT EXISTS idx_movements_org_date_cover
  ON stock_movements(org_id, created_at DESC)
  INCLUDE (item_id, movement_type, quantity, performed_by);

-- Covering index: item ledger history (second most common)
CREATE INDEX IF NOT EXISTS idx_movements_item_date_cover
  ON stock_movements(item_id, created_at DESC)
  INCLUDE (movement_type, quantity, balance_after, notes);

-- Reference lookup (for tracing back to approvals / stock takes)
CREATE INDEX IF NOT EXISTS idx_movements_ref_cover
  ON stock_movements(reference_type, reference_id)
  INCLUDE (item_id, quantity, created_at)
  WHERE reference_id IS NOT NULL;

-- ================================================================
-- 10. UPDATE RPC FUNCTIONS
--     Rebuild key RPC functions to use:
--       • new notification helpers (fn_notify_users / fn_notify_org)
--       • idempotency_key parameter
--       • organization_settings.allow_negative_stock config
-- ================================================================

-- Drop old versions first
DROP FUNCTION IF EXISTS rpc_record_movement(UUID,UUID,UUID,movement_type,NUMERIC,NUMERIC,TEXT,UUID,TEXT,UUID) CASCADE;
DROP FUNCTION IF EXISTS rpc_record_movement(UUID,UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID,TEXT,UUID) CASCADE;
DROP FUNCTION IF EXISTS rpc_process_approval(UUID,UUID,TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS rpc_approve_stock_take(UUID,UUID) CASCADE;
DROP FUNCTION IF EXISTS rpc_create_org_with_owner(UUID,TEXT,TEXT,UUID,TEXT,TEXT) CASCADE;

-- ── rpc_record_movement ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_record_movement(
  p_org_id          UUID,
  p_item_id         UUID,
  p_location_id     UUID,
  p_movement_type   TEXT,      -- movement_types.code (TEXT, not enum)
  p_quantity        NUMERIC,
  p_unit_cost       NUMERIC        DEFAULT NULL,
  p_reference_type  TEXT           DEFAULT NULL,
  p_reference_id    UUID           DEFAULT NULL,
  p_notes           TEXT           DEFAULT NULL,
  p_performed_by    UUID           DEFAULT NULL,
  p_idempotency_key TEXT           DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_movement_id      UUID;
  v_current_balance  NUMERIC;
  v_new_balance      NUMERIC;
  v_performer_id     UUID;
  v_movement_type_id UUID;
  v_allow_negative   BOOLEAN;
BEGIN
  v_performer_id := COALESCE(p_performed_by, auth.uid());

  -- Idempotency: if this key already exists, return the existing movement
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_movement_id
    FROM stock_movements
    WHERE org_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN v_movement_id;  -- idempotent: same key = same result
    END IF;
  END IF;

  -- Validate org isolation
  IF NOT EXISTS (
    SELECT 1 FROM inventory_items WHERE id = p_item_id AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Item % does not belong to org %', p_item_id, p_org_id;
  END IF;

  -- Resolve movement_type_id
  SELECT id INTO v_movement_type_id
  FROM movement_types
  WHERE code = p_movement_type
    AND (org_id = p_org_id OR org_id IS NULL)
  ORDER BY org_id NULLS LAST   -- org-specific overrides global
  LIMIT 1;

  -- Read allow_negative_stock setting
  SELECT COALESCE(allow_negative_stock, FALSE) INTO v_allow_negative
  FROM organization_settings WHERE org_id = p_org_id;

  -- Get current balance
  SELECT COALESCE(SUM(quantity), 0) INTO v_current_balance
  FROM inventory_balances
  WHERE item_id = p_item_id
    AND (p_location_id IS NULL OR location_id IS NOT DISTINCT FROM p_location_id);

  v_current_balance := COALESCE(v_current_balance, 0);
  v_new_balance     := v_current_balance + p_quantity;

  -- Enforce non-negative stock unless org allows it
  IF v_new_balance < 0 AND NOT COALESCE(v_allow_negative, FALSE) THEN
    RAISE EXCEPTION
      'Insufficient stock. Item: %, Current: %, Requested change: %',
      p_item_id, v_current_balance, p_quantity;
  END IF;

  -- Insert movement — triggers fn_update_inventory_balance automatically
  INSERT INTO stock_movements (
    org_id, item_id, location_id, movement_type, movement_type_id,
    quantity, unit_cost, reference_type, reference_id,
    idempotency_key, notes, performed_by, balance_after
  ) VALUES (
    p_org_id, p_item_id, p_location_id, p_movement_type, v_movement_type_id,
    p_quantity, p_unit_cost, p_reference_type, p_reference_id,
    p_idempotency_key, p_notes, v_performer_id, v_new_balance
  ) RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

-- ── rpc_process_approval ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_process_approval(
  p_approval_id UUID,
  p_reviewer_id UUID,
  p_decision    TEXT,
  p_notes       TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_approval      approval_requests%ROWTYPE;
  v_item_name     TEXT;
  v_reviewer_name TEXT;
  v_movement_id   UUID;
  v_event_id      UUID;
BEGIN
  SELECT * INTO v_approval
  FROM approval_requests
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request % not found', p_approval_id;
  END IF;

  IF v_approval.status <> 'pending' THEN
    RAISE EXCEPTION 'Approval % is already %', p_approval_id, v_approval.status;
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be "approved" or "rejected"';
  END IF;

  SELECT full_name INTO v_reviewer_name FROM users WHERE id = p_reviewer_id;
  SELECT name      INTO v_item_name     FROM inventory_items WHERE id = v_approval.item_id;

  UPDATE approval_requests SET
    status      = p_decision::approval_status,
    reviewed_by = p_reviewer_id,
    reviewed_at = NOW(),
    review_notes = p_notes
  WHERE id = p_approval_id;

  -- On approval of stock_adjustment → create the movement
  IF p_decision = 'approved'
     AND v_approval.type = 'stock_adjustment'
     AND v_approval.item_id IS NOT NULL
     AND v_approval.delta  IS NOT NULL
     AND v_approval.delta  <> 0
  THEN
    v_movement_id := rpc_record_movement(
      p_org_id          => v_approval.org_id,
      p_item_id         => v_approval.item_id,
      p_location_id     => NULL,
      p_movement_type   => CASE WHEN v_approval.delta > 0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END,
      p_quantity        => v_approval.delta,
      p_reference_type  => 'approval_request',
      p_reference_id    => p_approval_id,
      p_notes           => COALESCE(v_approval.reason, p_notes),
      p_performed_by    => p_reviewer_id
    );

    UPDATE approval_requests SET resulting_movement_id = v_movement_id WHERE id = p_approval_id;
  END IF;

  -- Notify the requester (direct)
  PERFORM fn_notify_users(
    v_approval.org_id,
    ARRAY[v_approval.requested_by],
    CASE WHEN p_decision = 'approved' THEN 'approval_approved' ELSE 'approval_rejected' END,
    CASE WHEN p_decision = 'approved' THEN '✅ Stock Request Approved' ELSE '❌ Stock Request Rejected' END,
    CASE WHEN p_decision = 'approved'
         THEN 'Your request for ' || COALESCE(v_item_name,'an item')
              || ' was approved by ' || COALESCE(v_reviewer_name,'a manager')
         ELSE 'Your request for ' || COALESCE(v_item_name,'an item')
              || ' was rejected by ' || COALESCE(v_reviewer_name,'a manager')
              || CASE WHEN p_notes IS NOT NULL THEN '. Reason: ' || p_notes ELSE '' END
    END,
    jsonb_build_object(
      'approvalId',   p_approval_id,
      'decision',     p_decision,
      'reviewedBy',   p_reviewer_id,
      'reviewerName', v_reviewer_name,
      'itemId',       v_approval.item_id,
      'itemName',     v_item_name,
      'delta',        v_approval.delta,
      'notes',        p_notes
    )
  );

  -- Org-wide broadcast on approval
  IF p_decision = 'approved' THEN
    PERFORM fn_notify_org(
      v_approval.org_id,
      'stock_adjustment_applied',
      '📦 Stock Adjustment Applied',
      COALESCE(v_reviewer_name,'A manager') || ' approved a '
        || CASE WHEN v_approval.delta > 0 THEN '+' ELSE '' END
        || v_approval.delta || ' unit adjustment for ' || COALESCE(v_item_name,'an item'),
      jsonb_build_object(
        'approvalId', p_approval_id,
        'itemId',     v_approval.item_id,
        'itemName',   v_item_name,
        'delta',      v_approval.delta
      )
    );
  END IF;

  -- Activity log
  INSERT INTO activity_logs (org_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    v_approval.org_id, p_reviewer_id,
    p_decision || '_approval',
    'approval_request', p_approval_id,
    jsonb_build_object(
      'decision', p_decision, 'notes', p_notes,
      'itemId', v_approval.item_id, 'itemName', v_item_name,
      'delta', v_approval.delta, 'movementId', v_movement_id
    )
  );
END;
$$;

-- ── rpc_approve_stock_take ───────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_approve_stock_take(
  p_session_id  UUID,
  p_approved_by UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session     stock_take_sessions%ROWTYPE;
  v_entry       stock_take_entries%ROWTYPE;
  v_movement_id UUID;
BEGIN
  SELECT * INTO v_session
  FROM stock_take_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock take session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'closed' THEN
    RAISE EXCEPTION 'Session must be "closed" before approval. Current: %', v_session.status;
  END IF;

  FOR v_entry IN
    SELECT * FROM stock_take_entries
    WHERE session_id = p_session_id AND variance <> 0
  LOOP
    v_movement_id := rpc_record_movement(
      p_org_id         => v_session.org_id,
      p_item_id        => v_entry.item_id,
      p_location_id    => v_entry.location_id,
      p_movement_type  => CASE WHEN v_entry.variance > 0 THEN 'STOCKTAKE_GAIN' ELSE 'STOCKTAKE_LOSS' END,
      p_quantity       => v_entry.variance,
      p_reference_type => 'stock_take_session',
      p_reference_id   => p_session_id,
      p_notes          => 'Stock take: ' || v_session.name,
      p_performed_by   => p_approved_by
    );

    UPDATE stock_take_entries SET movement_id = v_movement_id WHERE id = v_entry.id;
  END LOOP;

  UPDATE stock_take_sessions SET
    status = 'approved', approved_by = p_approved_by, approved_at = NOW()
  WHERE id = p_session_id;

  INSERT INTO activity_logs (org_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    v_session.org_id, p_approved_by, 'approve_stock_take',
    'stock_take_session', p_session_id,
    jsonb_build_object('sessionName', v_session.name)
  );

  PERFORM fn_notify_org(
    v_session.org_id,
    'stock_take_approved',
    '✅ Stock Take Approved',
    'Stock take "' || v_session.name || '" approved and balances updated.',
    jsonb_build_object('sessionId', p_session_id, 'sessionName', v_session.name)
  );
END;
$$;

-- ── rpc_create_org_with_owner ────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_create_org_with_owner(
  p_org_id     UUID,
  p_org_name   TEXT,
  p_org_plan   TEXT,
  p_user_id    UUID,
  p_user_email TEXT,
  p_user_name  TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner_role_id   UUID;
  v_manager_role_id UUID;
  v_staff_role_id   UUID;
BEGIN
  INSERT INTO organizations (id, name, subscription_plan)
  VALUES (p_org_id, p_org_name, COALESCE(p_org_plan, 'free'))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO roles (org_id, name, description, is_system) VALUES
    (p_org_id, 'owner',   'Full organization access',          TRUE),
    (p_org_id, 'manager', 'Inventory and approval management', TRUE),
    (p_org_id, 'staff',   'Day-to-day stock operations',       TRUE)
  ON CONFLICT (org_id, name) DO NOTHING;

  SELECT id INTO v_owner_role_id   FROM roles WHERE org_id = p_org_id AND name = 'owner';
  SELECT id INTO v_manager_role_id FROM roles WHERE org_id = p_org_id AND name = 'manager';
  SELECT id INTO v_staff_role_id   FROM roles WHERE org_id = p_org_id AND name = 'staff';

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_owner_role_id, id FROM permissions
  ON CONFLICT DO NOTHING;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_manager_role_id, id FROM permissions
  WHERE key IN (
    'inventory.read','inventory.write','stock.receive','stock.issue',
    'stock.adjust','stock.transfer','stocktake.create','stocktake.scan',
    'stocktake.approve','approvals.review','reports.view','reports.export'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_staff_role_id, id FROM permissions
  WHERE key IN (
    'inventory.read','stock.receive','stock.issue',
    'stock.adjust','stocktake.scan','reports.view'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO users (id, org_id, role_id, email, full_name, legacy_role)
  VALUES (p_user_id, p_org_id, v_owner_role_id, p_user_email, p_user_name, 'owner')
  ON CONFLICT (id) DO UPDATE
    SET org_id = p_org_id, role_id = v_owner_role_id, legacy_role = 'owner';

  INSERT INTO organization_settings (org_id) VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;

  INSERT INTO inventory_locations (org_id, name, type)
  VALUES (p_org_id, 'Main Warehouse', 'warehouse')
  ON CONFLICT (org_id, name) DO NOTHING;
END;
$$;

-- ── rpc_get_org_stock_summary — now respects soft delete ─────────
DROP FUNCTION IF EXISTS rpc_get_org_stock_summary(UUID) CASCADE;

CREATE OR REPLACE FUNCTION rpc_get_org_stock_summary(p_org_id UUID)
RETURNS TABLE (
  item_id         UUID,
  sku             TEXT,
  name            TEXT,
  category_id     UUID,
  unit_cost       NUMERIC,
  unit_price      NUMERIC,
  current_stock   NUMERIC,
  minimum_stock   INTEGER,
  reorder_point   INTEGER,
  is_low_stock    BOOLEAN,
  is_out_of_stock BOOLEAN,
  is_priority     BOOLEAN
)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT
    i.id, i.sku, i.name, i.category_id, i.unit_cost, i.unit_price,
    COALESCE(SUM(b.quantity), 0)                                                    AS current_stock,
    i.minimum_stock, i.reorder_point,
    COALESCE(SUM(b.quantity), 0) <= COALESCE(i.reorder_point, i.minimum_stock, 0)  AS is_low_stock,
    COALESCE(SUM(b.quantity), 0) <= 0                                               AS is_out_of_stock,
    i.is_priority
  FROM inventory_items i
  LEFT JOIN inventory_balances b ON b.item_id = i.id
  WHERE i.org_id     = p_org_id
    AND i.is_active  = TRUE
    AND i.deleted_at IS NULL     -- respect soft delete
  GROUP BY i.id
$$;

-- ================================================================
-- 11. UPDATE RLS POLICIES — use user_has_permission()
--     Drop and recreate policies that previously relied on
--     is_manager_or_owner() role string checks.
-- ================================================================

-- stock_movements — use permission check
DROP POLICY IF EXISTS "movements_manager_insert" ON stock_movements;
CREATE POLICY "movements_manager_insert" ON stock_movements
  FOR INSERT WITH CHECK (
    org_id = get_my_org_id()
    AND user_has_permission('stock.adjust')
  );

-- approval_requests — use permission check
DROP POLICY IF EXISTS "approvals_org" ON approval_requests;
CREATE POLICY "approvals_org_read" ON approval_requests
  FOR SELECT USING (org_id = get_my_org_id());

CREATE POLICY "approvals_staff_insert" ON approval_requests
  FOR INSERT WITH CHECK (
    org_id = get_my_org_id()
    AND user_has_permission('stock.adjust')
  );

CREATE POLICY "approvals_manager_update" ON approval_requests
  FOR UPDATE USING (
    org_id = get_my_org_id()
    AND user_has_permission('approvals.review')
  );

-- inventory_items — split read/write
DROP POLICY IF EXISTS "items_org_all" ON inventory_items;
CREATE POLICY "items_org_read" ON inventory_items
  FOR SELECT USING (org_id = get_my_org_id());

CREATE POLICY "items_org_write" ON inventory_items
  FOR INSERT WITH CHECK (
    org_id = get_my_org_id()
    AND user_has_permission('inventory.write')
  );

CREATE POLICY "items_org_update" ON inventory_items
  FOR UPDATE USING (
    org_id = get_my_org_id()
    AND user_has_permission('inventory.write')
  );

-- stock_take_sessions — use permission
DROP POLICY IF EXISTS "stocktake_sessions_org" ON stock_take_sessions;
CREATE POLICY "stocktake_sessions_read" ON stock_take_sessions
  FOR SELECT USING (org_id = get_my_org_id());

CREATE POLICY "stocktake_sessions_create" ON stock_take_sessions
  FOR INSERT WITH CHECK (
    org_id = get_my_org_id()
    AND user_has_permission('stocktake.create')
  );

CREATE POLICY "stocktake_sessions_update" ON stock_take_sessions
  FOR UPDATE USING (
    org_id = get_my_org_id()
    AND (user_has_permission('stocktake.create') OR user_has_permission('stocktake.approve'))
  );

-- stock_take_entries — scan permission
DROP POLICY IF EXISTS "stocktake_entries_org" ON stock_take_entries;
CREATE POLICY "stocktake_entries_read" ON stock_take_entries
  FOR SELECT USING (org_id = get_my_org_id());

CREATE POLICY "stocktake_entries_scan" ON stock_take_entries
  FOR INSERT WITH CHECK (
    org_id = get_my_org_id()
    AND user_has_permission('stocktake.scan')
  );

CREATE POLICY "stocktake_entries_update" ON stock_take_entries
  FOR UPDATE USING (
    org_id = get_my_org_id()
    AND user_has_permission('stocktake.scan')
  );

-- ================================================================
-- 12. REALTIME PUBLICATION — update with new tables
-- ================================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notification_events;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notification_recipients;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE device_sessions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================
-- DONE
-- ================================================================

COMMENT ON TABLE stock_movements IS
  'Immutable ledger — source of truth for all stock. '
  'PARTITION BY RANGE(created_at) recommended at 5M+ rows. '
  'Use rpc_record_movement() for all inserts — never direct INSERT.';

COMMENT ON COLUMN users.legacy_role IS
  'Kept for backward-compat with backend auth middleware. '
  'Use role_id → role_permissions → user_has_permission() for all new authorization logic. '
  'Remove this column once middleware is fully migrated to user_has_permission().';
