-- ================================================================
-- StockFlow Enterprise Schema v2.0
-- Event-driven, ledger-based, multi-tenant inventory architecture
--
-- DESTROYS all v1 tables and rebuilds from scratch.
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Requires PostgreSQL 15+ (Supabase default ✓)
-- ================================================================

-- ── Extensions ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fast SKU/name search

-- ================================================================
-- TEARDOWN — drop everything safely regardless of current state
-- Triggers are dropped implicitly by DROP TABLE ... CASCADE.
-- We use a DO block for functions/types so missing objects don't
-- abort the entire script (handles partial-delete scenarios).
-- ================================================================

-- Drop the auth trigger first (references a function we'll drop)
DO $$ BEGIN
  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Drop all functions (CASCADE removes any dependent triggers/policies)
DROP FUNCTION IF EXISTS fn_update_inventory_balance()                              CASCADE;
DROP FUNCTION IF EXISTS fn_movements_immutable()                                   CASCADE;
DROP FUNCTION IF EXISTS fn_check_low_stock()                                       CASCADE;
DROP FUNCTION IF EXISTS fn_set_updated_at()                                        CASCADE;
DROP FUNCTION IF EXISTS handle_new_auth_user()                                     CASCADE;
DROP FUNCTION IF EXISTS get_my_org_id()                                            CASCADE;
DROP FUNCTION IF EXISTS is_manager_or_owner()                                      CASCADE;
DROP FUNCTION IF EXISTS create_organization_with_owner(UUID,TEXT,TEXT,UUID,TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS rpc_create_org_with_owner(UUID,TEXT,TEXT,UUID,TEXT,TEXT)   CASCADE;
DROP FUNCTION IF EXISTS rpc_approve_stock_take(UUID,UUID)                          CASCADE;
DROP FUNCTION IF EXISTS rpc_process_approval(UUID,UUID,TEXT,TEXT)                  CASCADE;
DROP FUNCTION IF EXISTS rpc_get_item_stock(UUID,UUID)                              CASCADE;
DROP FUNCTION IF EXISTS rpc_get_org_stock_summary(UUID)                            CASCADE;

-- Drop the RPC that depends on the movement_type enum last
DO $$ BEGIN
  DROP FUNCTION IF EXISTS rpc_record_movement(UUID,UUID,UUID,movement_type,NUMERIC,NUMERIC,TEXT,UUID,TEXT,UUID) CASCADE;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Drop tables in reverse-dependency order (CASCADE handles FK chains)
DROP TABLE IF EXISTS fcm_tokens             CASCADE;
DROP TABLE IF EXISTS notifications          CASCADE;
DROP TABLE IF EXISTS activity_logs          CASCADE;
DROP TABLE IF EXISTS approval_requests      CASCADE;
DROP TABLE IF EXISTS stock_take_entries     CASCADE;
DROP TABLE IF EXISTS stock_take_sessions    CASCADE;
DROP TABLE IF EXISTS inventory_balances     CASCADE;
DROP TABLE IF EXISTS stock_movements        CASCADE;
DROP TABLE IF EXISTS inventory_items        CASCADE;
DROP TABLE IF EXISTS inventory_locations    CASCADE;
DROP TABLE IF EXISTS categories             CASCADE;
DROP TABLE IF EXISTS units_of_measure       CASCADE;
DROP TABLE IF EXISTS role_permissions       CASCADE;
DROP TABLE IF EXISTS permissions            CASCADE;
DROP TABLE IF EXISTS roles                  CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;
DROP TABLE IF EXISTS organization_settings  CASCADE;
DROP TABLE IF EXISTS organizations          CASCADE;

-- Drop enum types after tables (tables held references)
DROP TYPE IF EXISTS movement_type   CASCADE;
DROP TYPE IF EXISTS approval_status CASCADE;
DROP TYPE IF EXISTS approval_type   CASCADE;
DROP TABLE IF EXISTS organization_settings  CASCADE;
DROP TABLE IF EXISTS organizations          CASCADE;

-- ================================================================
-- DOMAIN TYPES
-- ================================================================

-- Every stock change must have a reason. This is the heart of the ledger.
CREATE TYPE movement_type AS ENUM (
  'OPENING_BALANCE',   -- initial stock on system go-live
  'RECEIVE',           -- goods received from supplier
  'SALE',              -- sold / issued to customer
  'TRANSFER_IN',       -- stock transferred in from another location
  'TRANSFER_OUT',      -- stock transferred out to another location
  'ADJUSTMENT_IN',     -- approved positive correction
  'ADJUSTMENT_OUT',    -- approved negative correction
  'DAMAGE',            -- written off as damaged / expired
  'RETURN_IN',         -- returned by customer
  'RETURN_OUT',        -- returned to supplier
  'STOCKTAKE_GAIN',    -- positive variance confirmed in stock take
  'STOCKTAKE_LOSS'     -- negative variance confirmed in stock take
);

CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TYPE approval_type AS ENUM (
  'stock_adjustment',
  'stock_take_session',
  'item_creation',
  'item_deletion',
  'item_update'
);

-- ================================================================
-- CORE TABLES
-- ================================================================

-- ── 1. organizations ────────────────────────────────────────────
-- Root of every tenant. Every other table scopes to this.
CREATE TABLE organizations (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT    NOT NULL,
  slug              TEXT    UNIQUE,
  subscription_plan TEXT    NOT NULL DEFAULT 'free'
                            CHECK (subscription_plan IN ('free','starter','professional','enterprise')),
  status            TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','suspended','cancelled')),
  -- All config lives here: currency, timezone, low_stock_threshold, zoho_config, pos_config, etc.
  settings          JSONB   NOT NULL DEFAULT '{}',
  -- Integration credentials and state
  integrations      JSONB   NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. roles ────────────────────────────────────────────────────
-- Org-scoped named roles. NOT hardcoded in application code.
CREATE TABLE roles (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,  -- system roles cannot be deleted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

-- ── 3. permissions ──────────────────────────────────────────────
-- Global permission definitions (not org-scoped — these are the keys)
CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,  -- e.g. 'inventory.write'
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'general'
);

-- ── 4. role_permissions ─────────────────────────────────────────
CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ── 5. users ────────────────────────────────────────────────────
-- App profile — mirrors auth.users but stores business context
CREATE TABLE users (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id      UUID REFERENCES roles(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  full_name    TEXT,
  avatar_url   TEXT,
  -- legacy_role: kept for backward compat during migration.
  -- New code should use role_id → role_permissions.
  legacy_role  TEXT NOT NULL DEFAULT 'staff'
               CHECK (legacy_role IN ('owner','manager','staff')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','inactive','pending')),
  invited_by   UUID REFERENCES users(id),
  last_seen_at TIMESTAMPTZ,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. categories ───────────────────────────────────────────────
CREATE TABLE categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  parent_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

-- ── 7. units_of_measure ─────────────────────────────────────────
CREATE TABLE units_of_measure (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  abbreviation TEXT,
  UNIQUE (org_id, name)
);

-- ── 8. inventory_locations ──────────────────────────────────────
-- Tree-structured location hierarchy: warehouse → shelf → bin
CREATE TABLE inventory_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'warehouse'
              CHECK (type IN ('warehouse','store','shelf','bin','van','virtual')),
  parent_id   UUID REFERENCES inventory_locations(id) ON DELETE SET NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

-- ── 9. inventory_items ──────────────────────────────────────────
-- PRODUCT MASTER DATA ONLY.
-- NO quantity, stock, or balance fields here.
-- Current stock is always derived from stock_movements via inventory_balances.
CREATE TABLE inventory_items (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id   UUID    REFERENCES categories(id) ON DELETE SET NULL,
  unit_id       UUID    REFERENCES units_of_measure(id) ON DELETE SET NULL,
  sku           TEXT    NOT NULL,
  barcode       TEXT,
  name          TEXT    NOT NULL,
  description   TEXT,
  unit_cost     NUMERIC(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  unit_price    NUMERIC(12,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  -- Alert thresholds (used by low-stock trigger)
  minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  reorder_point INTEGER CHECK (reorder_point IS NULL OR reorder_point >= 0),
  maximum_stock INTEGER CHECK (maximum_stock IS NULL OR maximum_stock >= 0),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_priority   BOOLEAN NOT NULL DEFAULT FALSE,
  image_url     TEXT,
  -- Arbitrary extra fields (supplier, location hint, zoho_id, etc.)
  metadata      JSONB   NOT NULL DEFAULT '{}',
  created_by    UUID    REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, sku)
);

-- ── 10. stock_movements ─────────────────────────────────────────
-- IMMUTABLE LEDGER — THE SOURCE OF TRUTH FOR ALL STOCK QUANTITIES.
--
-- Rules:
--   • positive quantity = stock coming IN (RECEIVE, ADJUSTMENT_IN, etc.)
--   • negative quantity = stock going OUT (SALE, DAMAGE, etc.)
--   • NEVER delete or update a movement row — ever
--   • All stock reads are derived from this table via inventory_balances
--
CREATE TABLE stock_movements (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID          NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  item_id         UUID          NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_id     UUID          REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  movement_type   movement_type NOT NULL,
  -- positive = in, negative = out. Never zero.
  quantity        NUMERIC(12,4) NOT NULL CHECK (quantity <> 0),
  unit_cost       NUMERIC(12,2),
  -- Trace back to the operation that caused this movement
  reference_type  TEXT,   -- 'approval_request' | 'stock_take_session' | 'manual'
  reference_id    UUID,
  notes           TEXT,
  performed_by    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Snapshot of the item's balance AFTER this movement (set by trigger)
  balance_after   NUMERIC(12,4),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Inbound movement types must have positive quantities
  CONSTRAINT chk_inbound_positive CHECK (
    movement_type NOT IN (
      'RECEIVE','TRANSFER_IN','ADJUSTMENT_IN',
      'RETURN_IN','STOCKTAKE_GAIN','OPENING_BALANCE'
    ) OR quantity > 0
  ),
  -- Outbound movement types must have negative quantities
  CONSTRAINT chk_outbound_negative CHECK (
    movement_type NOT IN (
      'SALE','TRANSFER_OUT','ADJUSTMENT_OUT',
      'DAMAGE','RETURN_OUT','STOCKTAKE_LOSS'
    ) OR quantity < 0
  )
);

-- ── 11. inventory_balances ──────────────────────────────────────
-- MATERIALIZED CACHE — updated automatically by trigger after each movement.
--
-- CRITICAL: Never write to this table directly from application code.
-- Always go through stock_movements → trigger updates this automatically.
-- The SECURITY DEFINER trigger function bypasses RLS for its writes.
--
CREATE TABLE inventory_balances (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id     UUID          NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id UUID          REFERENCES inventory_locations(id) ON DELETE CASCADE,
  quantity    NUMERIC(12,4) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- NULLS NOT DISTINCT (Postgres 15+): two rows with same item_id and location_id=NULL
  -- are treated as duplicates, enabling correct ON CONFLICT behavior.
  UNIQUE NULLS NOT DISTINCT (item_id, location_id)
);

-- ── 12. stock_take_sessions ─────────────────────────────────────
CREATE TABLE stock_take_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  location_id  UUID REFERENCES inventory_locations(id),
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','counting','closed','approved','rejected')),
  started_by   UUID NOT NULL REFERENCES users(id),
  closed_by    UUID REFERENCES users(id),
  approved_by  UUID REFERENCES users(id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  approved_at  TIMESTAMPTZ,
  notes        TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'
);

-- ── 13. stock_take_entries ──────────────────────────────────────
-- APK scans create rows here. Balances only change when a manager
-- approves the session — which then calls rpc_approve_stock_take.
CREATE TABLE stock_take_entries (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID          NOT NULL REFERENCES stock_take_sessions(id) ON DELETE CASCADE,
  org_id         UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id        UUID          NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_id    UUID          REFERENCES inventory_locations(id),
  expected_qty   NUMERIC(12,4) NOT NULL DEFAULT 0,
  counted_qty    NUMERIC(12,4) NOT NULL DEFAULT 0,
  -- Computed column: no need to calculate in app code
  variance       NUMERIC(12,4) GENERATED ALWAYS AS (counted_qty - expected_qty) STORED,
  counted_by     UUID          NOT NULL REFERENCES users(id),
  -- Populated by rpc_approve_stock_take when variance is actioned
  movement_id    UUID          REFERENCES stock_movements(id),
  counted_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  notes          TEXT,
  UNIQUE (session_id, item_id, location_id)
);

-- ── 14. approval_requests ───────────────────────────────────────
-- All review-gated operations go through here before touching inventory.
CREATE TABLE approval_requests (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type                  approval_type   NOT NULL,
  status                approval_status NOT NULL DEFAULT 'pending',
  -- What this approval is for
  reference_type        TEXT            NOT NULL DEFAULT 'manual',
  reference_id          UUID,
  -- Denormalized item context for display (no JOIN needed in notification text)
  item_id               UUID            REFERENCES inventory_items(id),
  delta                 NUMERIC(12,4),  -- positive = add stock, negative = remove
  reason                TEXT,
  -- Actors
  requested_by          UUID            NOT NULL REFERENCES users(id),
  reviewed_by           UUID            REFERENCES users(id),
  -- Timestamps
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  reviewed_at           TIMESTAMPTZ,
  -- Review outcome
  review_notes          TEXT,
  -- The movement created when this is approved (traceability)
  resulting_movement_id UUID            REFERENCES stock_movements(id),
  metadata              JSONB           NOT NULL DEFAULT '{}'
);

-- ── 15. notifications ───────────────────────────────────────────
-- Database-backed notification store.
-- user_id = NULL means org-wide broadcast (all members see it).
-- Push (FCM) is fired AFTER this row is inserted — DB is truth.
CREATE TABLE notifications (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID    NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID    REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL DEFAULT '',
  data       JSONB   NOT NULL DEFAULT '{}',
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 16. fcm_tokens ──────────────────────────────────────────────
-- One row per device per user. Multiple devices per user are supported.
CREATE TABLE fcm_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  platform       TEXT NOT NULL DEFAULT 'android'
                 CHECK (platform IN ('android','ios','web')),
  token          TEXT NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id),
  UNIQUE (token)
);

-- ── 17. activity_logs ───────────────────────────────────────────
-- Immutable audit trail. Insert-only. Never update or delete.
CREATE TABLE activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,    -- e.g. 'approve_request', 'record_movement', 'create_item'
  entity_type TEXT,             -- e.g. 'inventory_item', 'approval_request'
  entity_id   UUID,
  details     JSONB NOT NULL DEFAULT '{}',
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- SEED: PERMISSION DEFINITIONS (global, not org-scoped)
-- ================================================================

INSERT INTO permissions (key, description, category) VALUES
  ('inventory.read',       'View inventory items and stock levels',     'inventory'),
  ('inventory.write',      'Create and update inventory items',         'inventory'),
  ('inventory.delete',     'Archive or delete inventory items',         'inventory'),
  ('stock.receive',        'Record stock receipts from suppliers',      'stock'),
  ('stock.issue',          'Record stock issues / sales',               'stock'),
  ('stock.adjust',         'Submit stock adjustment requests',          'stock'),
  ('stock.transfer',       'Record stock transfers between locations',  'stock'),
  ('stocktake.create',     'Start a new stock take session',            'stocktake'),
  ('stocktake.scan',       'Scan items during a stock take',            'stocktake'),
  ('stocktake.approve',    'Approve or reject completed stock takes',   'stocktake'),
  ('approvals.review',     'Approve or reject pending requests',        'approvals'),
  ('reports.view',         'View reports and analytics',                'reports'),
  ('reports.export',       'Export reports to CSV / PDF',               'reports'),
  ('users.manage',         'Invite and manage team members',            'users'),
  ('settings.manage',      'Manage organization settings',              'settings'),
  ('locations.manage',     'Manage inventory locations',                'settings')
ON CONFLICT (key) DO NOTHING;

-- ================================================================
-- INDEXES
-- ================================================================

-- organizations
CREATE INDEX idx_orgs_status            ON organizations(status);

-- users
CREATE INDEX idx_users_org              ON users(org_id);
CREATE INDEX idx_users_email            ON users(email);
CREATE INDEX idx_users_org_role         ON users(org_id, legacy_role);

-- inventory_items — trigram indexes enable fast ILIKE / full-text search
CREATE INDEX idx_items_org              ON inventory_items(org_id);
CREATE INDEX idx_items_org_active       ON inventory_items(org_id, is_active);
CREATE INDEX idx_items_org_priority     ON inventory_items(org_id, is_priority) WHERE is_priority = TRUE;
CREATE INDEX idx_items_sku_trgm         ON inventory_items USING GIN (sku gin_trgm_ops);
CREATE INDEX idx_items_name_trgm        ON inventory_items USING GIN (name gin_trgm_ops);

-- stock_movements — highest query volume in the system
CREATE INDEX idx_movements_org_item     ON stock_movements(org_id, item_id);
CREATE INDEX idx_movements_org_date     ON stock_movements(org_id, created_at DESC);
CREATE INDEX idx_movements_item_date    ON stock_movements(item_id, created_at DESC);
CREATE INDEX idx_movements_type         ON stock_movements(org_id, movement_type);
CREATE INDEX idx_movements_reference    ON stock_movements(reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX idx_movements_performer    ON stock_movements(performed_by);

-- inventory_balances
CREATE INDEX idx_balances_org_item      ON inventory_balances(org_id, item_id);
CREATE INDEX idx_balances_low_stock     ON inventory_balances(org_id, quantity);

-- stock_take
CREATE INDEX idx_stocktake_org_status   ON stock_take_sessions(org_id, status);
CREATE INDEX idx_ste_session            ON stock_take_entries(session_id);
CREATE INDEX idx_ste_item               ON stock_take_entries(item_id);

-- approval_requests
CREATE INDEX idx_approvals_org_status   ON approval_requests(org_id, status);
CREATE INDEX idx_approvals_requested    ON approval_requests(requested_by, status);
CREATE INDEX idx_approvals_item         ON approval_requests(item_id) WHERE item_id IS NOT NULL;

-- notifications — most critical for UI responsiveness
CREATE INDEX idx_notif_user_unread      ON notifications(org_id, user_id, is_read);
CREATE INDEX idx_notif_org_date         ON notifications(org_id, created_at DESC);
CREATE INDEX idx_notif_broadcast        ON notifications(org_id, created_at DESC)
  WHERE user_id IS NULL;

-- fcm_tokens
CREATE INDEX idx_fcm_user               ON fcm_tokens(user_id);
CREATE INDEX idx_fcm_org                ON fcm_tokens(org_id);

-- activity_logs
CREATE INDEX idx_activity_org_date      ON activity_logs(org_id, created_at DESC);
CREATE INDEX idx_activity_entity        ON activity_logs(entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
CREATE INDEX idx_activity_user          ON activity_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ================================================================
-- HELPER FUNCTIONS
-- ================================================================

-- Returns the calling user's org_id (stable per query — very fast)
CREATE OR REPLACE FUNCTION get_my_org_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid()
$$;

-- Returns true when the calling user is owner or manager
CREATE OR REPLACE FUNCTION is_manager_or_owner()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND legacy_role IN ('owner', 'manager')
  )
$$;

-- Auto-updates updated_at timestamp
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ================================================================
-- TRIGGERS — UPDATED_AT
-- ================================================================

CREATE TRIGGER trg_orgs_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ================================================================
-- TRIGGER — INVENTORY BALANCE UPDATE
-- Fires AFTER every INSERT on stock_movements.
-- Updates the materialized balance cache atomically.
-- SECURITY DEFINER bypasses RLS so balance updates always succeed.
-- ================================================================

CREATE OR REPLACE FUNCTION fn_update_inventory_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO inventory_balances (org_id, item_id, location_id, quantity, updated_at)
  VALUES (NEW.org_id, NEW.item_id, NEW.location_id, NEW.quantity, NOW())
  ON CONFLICT (item_id, location_id)
  DO UPDATE SET
    quantity   = inventory_balances.quantity + EXCLUDED.quantity,
    updated_at = NOW();

  -- Write the post-movement snapshot back to the movement row
  UPDATE stock_movements
  SET balance_after = (
    SELECT quantity
    FROM inventory_balances
    WHERE item_id = NEW.item_id
      AND location_id IS NOT DISTINCT FROM NEW.location_id
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_movements_update_balance
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_update_inventory_balance();

-- ================================================================
-- TRIGGER — MOVEMENT IMMUTABILITY
-- Prevents any UPDATE or DELETE on the ledger table.
-- Redundant with the RLS "no update" policies — belt AND suspenders.
-- ================================================================

CREATE OR REPLACE FUNCTION fn_movements_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'stock_movements is an immutable ledger. Movements cannot be modified or deleted. id=%', OLD.id;
END;
$$;

CREATE TRIGGER trg_movements_immutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_movements_immutable();

-- ================================================================
-- TRIGGER — LOW STOCK ALERT
-- Fires after inventory_balances is updated.
-- Inserts an org-wide notification when stock crosses below reorder_point.
-- ================================================================

CREATE OR REPLACE FUNCTION fn_check_low_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_item inventory_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM inventory_items WHERE id = NEW.item_id;

  -- Only fire when stock drops BELOW the threshold for the first time
  -- (not on every update — avoids notification spam)
  IF v_item.is_active
     AND v_item.reorder_point IS NOT NULL
     AND NEW.quantity <= v_item.reorder_point
     AND (TG_OP = 'INSERT' OR (OLD IS NOT NULL AND OLD.quantity > v_item.reorder_point))
  THEN
    INSERT INTO notifications (org_id, user_id, type, title, body, data)
    VALUES (
      NEW.org_id,
      NULL,   -- org-wide broadcast
      'low_stock',
      '⚠️ Low Stock Alert',
      v_item.name || ' has dropped to ' || ROUND(NEW.quantity) || ' units'
        || ' (reorder point: ' || v_item.reorder_point || ')',
      jsonb_build_object(
        'itemId',       v_item.id,
        'itemName',     v_item.name,
        'sku',          v_item.sku,
        'currentQty',   NEW.quantity,
        'reorderPoint', v_item.reorder_point,
        'minimumStock', v_item.minimum_stock
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_balance_low_stock
  AFTER INSERT OR UPDATE ON inventory_balances
  FOR EACH ROW EXECUTE FUNCTION fn_check_low_stock();

-- ================================================================
-- AUTH TRIGGER — auto-create public.users on sign-up / invite
-- ================================================================

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'org_id' IS NOT NULL THEN
    INSERT INTO public.users (id, email, full_name, org_id, legacy_role)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      (NEW.raw_user_meta_data->>'org_id')::UUID,
      COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ================================================================
-- RPC FUNCTIONS
-- Called from the backend with service_role key.
-- All inventory mutations MUST go through these — never raw SQL from frontend.
-- ================================================================

-- ── rpc_create_org_with_owner ────────────────────────────────────
-- Atomically creates an organization + owner user + seeds system roles.
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
  v_owner_role_id UUID;
  v_manager_role_id UUID;
  v_staff_role_id UUID;
  v_perm_id UUID;
BEGIN
  -- Create org
  INSERT INTO organizations (id, name, subscription_plan)
  VALUES (p_org_id, p_org_name, COALESCE(p_org_plan, 'free'))
  ON CONFLICT (id) DO NOTHING;

  -- Seed system roles for this org
  INSERT INTO roles (org_id, name, description, is_system) VALUES
    (p_org_id, 'owner',   'Full organization access',              TRUE),
    (p_org_id, 'manager', 'Inventory and approval management',     TRUE),
    (p_org_id, 'staff',   'Day-to-day stock operations',           TRUE)
  ON CONFLICT (org_id, name) DO NOTHING
  RETURNING id INTO v_owner_role_id;

  SELECT id INTO v_owner_role_id  FROM roles WHERE org_id = p_org_id AND name = 'owner';
  SELECT id INTO v_manager_role_id FROM roles WHERE org_id = p_org_id AND name = 'manager';
  SELECT id INTO v_staff_role_id  FROM roles WHERE org_id = p_org_id AND name = 'staff';

  -- Grant all permissions to owner role
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_owner_role_id, id FROM permissions
  ON CONFLICT DO NOTHING;

  -- Grant standard manager permissions
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_manager_role_id, id FROM permissions
  WHERE key IN (
    'inventory.read','inventory.write','stock.receive','stock.issue',
    'stock.adjust','stock.transfer','stocktake.create','stocktake.scan',
    'stocktake.approve','approvals.review','reports.view','reports.export'
  )
  ON CONFLICT DO NOTHING;

  -- Grant staff permissions
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_staff_role_id, id FROM permissions
  WHERE key IN (
    'inventory.read','stock.receive','stock.issue',
    'stock.adjust','stocktake.scan','reports.view'
  )
  ON CONFLICT DO NOTHING;

  -- Create owner user profile
  INSERT INTO users (id, org_id, role_id, email, full_name, legacy_role)
  VALUES (p_user_id, p_org_id, v_owner_role_id, p_user_email, p_user_name, 'owner')
  ON CONFLICT (id) DO UPDATE
    SET org_id = p_org_id,
        role_id = v_owner_role_id,
        legacy_role = 'owner';

  -- Seed a default "Main Warehouse" location
  INSERT INTO inventory_locations (org_id, name, type)
  VALUES (p_org_id, 'Main Warehouse', 'warehouse')
  ON CONFLICT (org_id, name) DO NOTHING;
END;
$$;

-- ── rpc_record_movement ──────────────────────────────────────────
-- THE ONLY safe way to create a stock movement.
-- Validates org isolation, optionally prevents negative stock,
-- then inserts — triggering the balance update automatically.
CREATE OR REPLACE FUNCTION rpc_record_movement(
  p_org_id         UUID,
  p_item_id        UUID,
  p_location_id    UUID,
  p_movement_type  movement_type,
  p_quantity       NUMERIC,
  p_unit_cost      NUMERIC        DEFAULT NULL,
  p_reference_type TEXT           DEFAULT NULL,
  p_reference_id   UUID           DEFAULT NULL,
  p_notes          TEXT           DEFAULT NULL,
  p_performed_by   UUID           DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_movement_id     UUID;
  v_current_balance NUMERIC;
  v_new_balance     NUMERIC;
  v_performer_id    UUID;
BEGIN
  v_performer_id := COALESCE(p_performed_by, auth.uid());

  -- Validate org isolation: item must belong to this org
  IF NOT EXISTS (
    SELECT 1 FROM inventory_items
    WHERE id = p_item_id AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Item % does not belong to org %', p_item_id, p_org_id;
  END IF;

  -- Get current balance (aggregate across all locations if location_id is NULL)
  SELECT COALESCE(SUM(quantity), 0) INTO v_current_balance
  FROM inventory_balances
  WHERE item_id = p_item_id
    AND (p_location_id IS NULL OR location_id IS NOT DISTINCT FROM p_location_id);

  v_new_balance := v_current_balance + p_quantity;

  -- Prevent negative stock (remove this block if backorders are allowed)
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION
      'Insufficient stock for item %. Current balance: %, Requested change: %',
      p_item_id, v_current_balance, p_quantity;
  END IF;

  -- Insert movement — triggers fn_update_inventory_balance automatically
  INSERT INTO stock_movements (
    org_id, item_id, location_id, movement_type, quantity,
    unit_cost, reference_type, reference_id, notes,
    performed_by, balance_after
  ) VALUES (
    p_org_id, p_item_id, p_location_id, p_movement_type, p_quantity,
    p_unit_cost, p_reference_type, p_reference_id, p_notes,
    v_performer_id, v_new_balance
  ) RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

-- ── rpc_process_approval ─────────────────────────────────────────
-- Atomically approves OR rejects an approval_request.
-- On approval of a stock_adjustment: creates the movement, updates balances.
-- Always writes notifications and activity log inside the same transaction.
CREATE OR REPLACE FUNCTION rpc_process_approval(
  p_approval_id UUID,
  p_reviewer_id UUID,
  p_decision    TEXT,   -- 'approved' | 'rejected'
  p_notes       TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_approval      approval_requests%ROWTYPE;
  v_item_name     TEXT;
  v_reviewer_name TEXT;
  v_movement_id   UUID;
BEGIN
  -- Lock the row to prevent concurrent double-approvals
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
    RAISE EXCEPTION 'Decision must be "approved" or "rejected", got: %', p_decision;
  END IF;

  -- Resolve display names for notifications
  SELECT full_name INTO v_reviewer_name FROM users WHERE id = p_reviewer_id;
  SELECT name      INTO v_item_name     FROM inventory_items WHERE id = v_approval.item_id;

  -- Update the approval request
  UPDATE approval_requests SET
    status      = p_decision::approval_status,
    reviewed_by = p_reviewer_id,
    reviewed_at = NOW(),
    review_notes = p_notes
  WHERE id = p_approval_id;

  -- If approved and this is a stock adjustment → create the movement
  IF p_decision = 'approved'
     AND v_approval.type = 'stock_adjustment'
     AND v_approval.item_id IS NOT NULL
     AND v_approval.delta IS NOT NULL
     AND v_approval.delta <> 0
  THEN
    v_movement_id := rpc_record_movement(
      p_org_id         => v_approval.org_id,
      p_item_id        => v_approval.item_id,
      p_location_id    => NULL,
      p_movement_type  => CASE WHEN v_approval.delta > 0
                               THEN 'ADJUSTMENT_IN'::movement_type
                               ELSE 'ADJUSTMENT_OUT'::movement_type END,
      p_quantity       => v_approval.delta,
      p_reference_type => 'approval_request',
      p_reference_id   => p_approval_id,
      p_notes          => COALESCE(v_approval.reason, p_notes),
      p_performed_by   => p_reviewer_id
    );

    -- Trace: link the movement back to this approval
    UPDATE approval_requests
    SET resulting_movement_id = v_movement_id
    WHERE id = p_approval_id;
  END IF;

  -- ── Notify the requester (direct) ────────────────────────────
  INSERT INTO notifications (org_id, user_id, type, title, body, data)
  VALUES (
    v_approval.org_id,
    v_approval.requested_by,
    CASE WHEN p_decision = 'approved' THEN 'approval_approved' ELSE 'approval_rejected' END,
    CASE WHEN p_decision = 'approved' THEN '✅ Stock Request Approved' ELSE '❌ Stock Request Rejected' END,
    CASE WHEN p_decision = 'approved'
         THEN 'Your request for ' || COALESCE(v_item_name, 'an item')
              || ' was approved by ' || COALESCE(v_reviewer_name, 'a manager')
         ELSE 'Your request for ' || COALESCE(v_item_name, 'an item')
              || ' was rejected by ' || COALESCE(v_reviewer_name, 'a manager')
              || CASE WHEN p_notes IS NOT NULL THEN '. Reason: ' || p_notes ELSE '' END
    END,
    jsonb_build_object(
      'approvalId',    p_approval_id,
      'decision',      p_decision,
      'reviewedBy',    p_reviewer_id,
      'reviewerName',  v_reviewer_name,
      'itemId',        v_approval.item_id,
      'itemName',      v_item_name,
      'delta',         v_approval.delta,
      'notes',         p_notes
    )
  );

  -- ── Notify org-wide on approval (for managers to track) ──────
  IF p_decision = 'approved' THEN
    INSERT INTO notifications (org_id, user_id, type, title, body, data)
    VALUES (
      v_approval.org_id,
      NULL,  -- org-wide broadcast
      'stock_adjustment_applied',
      '📦 Stock Adjustment Applied',
      COALESCE(v_reviewer_name, 'A manager') || ' approved a '
        || CASE WHEN v_approval.delta > 0 THEN '+' ELSE '' END
        || v_approval.delta || ' unit adjustment for ' || COALESCE(v_item_name, 'an item'),
      jsonb_build_object(
        'approvalId', p_approval_id,
        'itemId',     v_approval.item_id,
        'itemName',   v_item_name,
        'delta',      v_approval.delta
      )
    );
  END IF;

  -- ── Activity log ─────────────────────────────────────────────
  INSERT INTO activity_logs (org_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    v_approval.org_id,
    p_reviewer_id,
    p_decision || '_approval',
    'approval_request',
    p_approval_id,
    jsonb_build_object(
      'decision',      p_decision,
      'notes',         p_notes,
      'itemId',        v_approval.item_id,
      'itemName',      v_item_name,
      'delta',         v_approval.delta,
      'movementId',    v_movement_id
    )
  );
END;
$$;

-- ── rpc_approve_stock_take ───────────────────────────────────────
-- Atomically approves a completed stock take session:
--   1. Verifies session is in 'closed' status
--   2. For every entry with variance != 0 → calls rpc_record_movement
--   3. Marks session as 'approved'
--   4. Writes activity log
CREATE OR REPLACE FUNCTION rpc_approve_stock_take(
  p_session_id  UUID,
  p_approved_by UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session     stock_take_sessions%ROWTYPE;
  v_entry       stock_take_entries%ROWTYPE;
  v_movement_id UUID;
BEGIN
  SELECT * INTO v_session
  FROM stock_take_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock take session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'closed' THEN
    RAISE EXCEPTION
      'Session must be "closed" before approval. Current status: %', v_session.status;
  END IF;

  -- Create a movement for every entry that has a non-zero variance
  FOR v_entry IN
    SELECT * FROM stock_take_entries
    WHERE session_id = p_session_id AND variance <> 0
  LOOP
    v_movement_id := rpc_record_movement(
      p_org_id         => v_session.org_id,
      p_item_id        => v_entry.item_id,
      p_location_id    => v_entry.location_id,
      p_movement_type  => CASE WHEN v_entry.variance > 0
                               THEN 'STOCKTAKE_GAIN'::movement_type
                               ELSE 'STOCKTAKE_LOSS'::movement_type END,
      p_quantity       => v_entry.variance,
      p_reference_type => 'stock_take_session',
      p_reference_id   => p_session_id,
      p_notes          => 'Stock take reconciliation — session: ' || v_session.name,
      p_performed_by   => p_approved_by
    );

    UPDATE stock_take_entries SET movement_id = v_movement_id WHERE id = v_entry.id;
  END LOOP;

  -- Mark session approved
  UPDATE stock_take_sessions SET
    status      = 'approved',
    approved_by = p_approved_by,
    approved_at = NOW()
  WHERE id = p_session_id;

  -- Activity log
  INSERT INTO activity_logs (org_id, user_id, action, entity_type, entity_id, details)
  VALUES (
    v_session.org_id,
    p_approved_by,
    'approve_stock_take',
    'stock_take_session',
    p_session_id,
    jsonb_build_object('sessionName', v_session.name)
  );

  -- Org-wide notification
  INSERT INTO notifications (org_id, user_id, type, title, body, data)
  VALUES (
    v_session.org_id,
    NULL,
    'stock_take_approved',
    '✅ Stock Take Approved',
    'Stock take "' || v_session.name || '" has been approved and balances updated.',
    jsonb_build_object('sessionId', p_session_id, 'sessionName', v_session.name)
  );
END;
$$;

-- ── rpc_get_item_stock ───────────────────────────────────────────
-- Fast read of current stock for one item (from the materialized cache).
CREATE OR REPLACE FUNCTION rpc_get_item_stock(
  p_item_id     UUID,
  p_location_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(SUM(quantity), 0)
  FROM inventory_balances
  WHERE item_id = p_item_id
    AND (p_location_id IS NULL OR location_id IS NOT DISTINCT FROM p_location_id)
$$;

-- ── rpc_get_org_stock_summary ────────────────────────────────────
-- Returns all active items with their current stock levels.
-- Used by the dashboard for the main inventory table.
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
    i.id,
    i.sku,
    i.name,
    i.category_id,
    i.unit_cost,
    i.unit_price,
    COALESCE(SUM(b.quantity), 0)                                                       AS current_stock,
    i.minimum_stock,
    i.reorder_point,
    COALESCE(SUM(b.quantity), 0) <= COALESCE(i.reorder_point, i.minimum_stock, 0)     AS is_low_stock,
    COALESCE(SUM(b.quantity), 0) <= 0                                                  AS is_out_of_stock,
    i.is_priority
  FROM inventory_items i
  LEFT JOIN inventory_balances b ON b.item_id = i.id
  WHERE i.org_id = p_org_id
    AND i.is_active = TRUE
  GROUP BY i.id
$$;

-- ================================================================
-- ROW LEVEL SECURITY
-- Every table is scoped to the calling user's org_id.
-- The backend uses service_role which bypasses RLS entirely.
-- ================================================================

ALTER TABLE organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fcm_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs        ENABLE ROW LEVEL SECURITY;

-- ── organizations ────────────────────────────────────────────────
CREATE POLICY "org_members_view"        ON organizations
  FOR SELECT USING (id = get_my_org_id());

-- ── roles ────────────────────────────────────────────────────────
CREATE POLICY "roles_org"               ON roles
  FOR ALL USING (org_id = get_my_org_id());

-- ── permissions ──────────────────────────────────────────────────
CREATE POLICY "permissions_any_authed"  ON permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── role_permissions ─────────────────────────────────────────────
CREATE POLICY "role_perms_org"          ON role_permissions
  FOR SELECT USING (
    role_id IN (SELECT id FROM roles WHERE org_id = get_my_org_id())
  );

CREATE POLICY "role_perms_manager_write" ON role_permissions
  FOR ALL USING (
    is_manager_or_owner()
    AND role_id IN (SELECT id FROM roles WHERE org_id = get_my_org_id())
  );

-- ── users ────────────────────────────────────────────────────────
CREATE POLICY "users_see_org_members"   ON users
  FOR SELECT USING (org_id = get_my_org_id());

CREATE POLICY "users_update_own"        ON users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "managers_manage_users"   ON users
  FOR ALL USING (org_id = get_my_org_id() AND is_manager_or_owner());

-- ── categories / units / locations ───────────────────────────────
CREATE POLICY "categories_org"          ON categories
  FOR ALL USING (org_id = get_my_org_id());

CREATE POLICY "units_org"               ON units_of_measure
  FOR ALL USING (org_id = get_my_org_id());

CREATE POLICY "locations_org"           ON inventory_locations
  FOR ALL USING (org_id = get_my_org_id());

-- ── inventory_items ──────────────────────────────────────────────
CREATE POLICY "items_org_all"           ON inventory_items
  FOR ALL USING (org_id = get_my_org_id());

-- ── stock_movements ──────────────────────────────────────────────
-- Anyone in org can read the full ledger (audit transparency)
CREATE POLICY "movements_org_read"      ON stock_movements
  FOR SELECT USING (org_id = get_my_org_id());

-- Only managers/owners can insert movements directly
-- (Staff always goes through approval_requests → rpc_process_approval)
CREATE POLICY "movements_manager_insert" ON stock_movements
  FOR INSERT WITH CHECK (
    org_id = get_my_org_id() AND is_manager_or_owner()
  );

-- Immutable: no direct updates or deletes from any API client
CREATE POLICY "movements_no_update"     ON stock_movements FOR UPDATE USING (FALSE);
CREATE POLICY "movements_no_delete"     ON stock_movements FOR DELETE USING (FALSE);

-- ── inventory_balances ────────────────────────────────────────────
-- Read-only via API. Written exclusively by the SECURITY DEFINER trigger.
CREATE POLICY "balances_org_read"       ON inventory_balances
  FOR SELECT USING (org_id = get_my_org_id());

-- No INSERT / UPDATE / DELETE policies for API clients.
-- fn_update_inventory_balance is SECURITY DEFINER → bypasses RLS.

-- ── stock_take_sessions / entries ────────────────────────────────
CREATE POLICY "stocktake_sessions_org"  ON stock_take_sessions
  FOR ALL USING (org_id = get_my_org_id());

CREATE POLICY "stocktake_entries_org"   ON stock_take_entries
  FOR ALL USING (org_id = get_my_org_id());

-- ── approval_requests ────────────────────────────────────────────
CREATE POLICY "approvals_org"           ON approval_requests
  FOR ALL USING (org_id = get_my_org_id());

-- ── notifications ─────────────────────────────────────────────────
-- Users see their own targeted notifications + org-wide broadcasts (user_id IS NULL)
CREATE POLICY "notifications_own_or_broadcast" ON notifications
  FOR SELECT USING (
    org_id = get_my_org_id()
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

CREATE POLICY "notifications_mark_read" ON notifications
  FOR UPDATE USING (
    org_id = get_my_org_id()
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

-- Inserts come from backend (service_role) or SECURITY DEFINER RPCs
-- No client-side insert policy needed

-- ── fcm_tokens ────────────────────────────────────────────────────
CREATE POLICY "fcm_own_device_tokens"   ON fcm_tokens
  FOR ALL USING (user_id = auth.uid());

-- ── activity_logs ─────────────────────────────────────────────────
CREATE POLICY "activity_org_read"       ON activity_logs
  FOR SELECT USING (org_id = get_my_org_id());

-- Inserts only from backend (service_role) — no client write policy

-- ================================================================
-- REALTIME PUBLICATION
-- Tables that the dashboard subscribes to for live updates.
-- stock_movements is append-only so realtime is safe.
-- ================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory_balances;
ALTER PUBLICATION supabase_realtime ADD TABLE approval_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE stock_take_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE stock_take_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE activity_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE stock_movements;
