-- ============================================================
-- StockFlow — Supabase PostgreSQL Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  plan        TEXT DEFAULT 'free',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','manager','staff')),
  is_active   BOOLEAN DEFAULT TRUE,
  invited_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  quantity      INTEGER NOT NULL DEFAULT 0,
  min_quantity  INTEGER DEFAULT 10,
  unit_price    NUMERIC(12,2),
  cost_price    NUMERIC(12,2),
  is_active     BOOLEAN DEFAULT TRUE,
  is_priority   BOOLEAN DEFAULT FALSE,
  source        TEXT DEFAULT 'manual',
  location      TEXT,
  description   TEXT,
  unit          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, sku)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  actor_id     UUID REFERENCES users(id),
  details      JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  item_id       UUID REFERENCES inventory_items(id),
  delta         INTEGER,
  reason        TEXT,
  requested_by  UUID REFERENCES users(id),
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by   UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_take_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT,
  status       TEXT DEFAULT 'open' CHECK (status IN ('open','closed','approved')),
  started_by   UUID REFERENCES users(id),
  closed_by    UUID REFERENCES users(id),
  approved_by  UUID REFERENCES users(id),
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  approved_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_take_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES stock_take_sessions(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id           UUID REFERENCES inventory_items(id),
  sku               TEXT,
  counted_quantity  INTEGER NOT NULL,
  expected_quantity INTEGER,
  scanned_by        UUID REFERENCES users(id),
  scanned_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_settings (
  org_id                    UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  low_stock_threshold       INTEGER DEFAULT 10,
  currency                  TEXT DEFAULT 'ZAR',
  timezone                  TEXT DEFAULT 'Africa/Johannesburg',
  theme                     TEXT DEFAULT 'light',
  notification_preferences  JSONB DEFAULT '{}',
  zoho_config               JSONB DEFAULT '{}',
  pos_config                JSONB DEFAULT '{}',
  payfast_config            JSONB DEFAULT '{}',
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT,
  data        JSONB,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  device_name     TEXT,
  registered_at   TIMESTAMPTZ DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_org           ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_inventory_org       ON inventory_items(org_id);
CREATE INDEX IF NOT EXISTS idx_inventory_sku       ON inventory_items(org_id, sku);
CREATE INDEX IF NOT EXISTS idx_inventory_active    ON inventory_items(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_activity_org_date   ON activity_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_org_status ON approval_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_stocktake_session   ON stock_take_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user  ON notifications(user_id, is_read);

-- ── Row Level Security ────────────────────────────────────────

ALTER TABLE organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fcm_tokens          ENABLE ROW LEVEL SECURITY;

-- Helper: get the calling user's org_id (cached per query — fast)
CREATE OR REPLACE FUNCTION get_my_org_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid()
$$;

-- Organizations: members of the org can see it
CREATE POLICY "org_members_can_view" ON organizations
  FOR SELECT USING (id = get_my_org_id());

-- Users: anyone in the same org can see org members
CREATE POLICY "users_see_own_org" ON users
  FOR SELECT USING (org_id = get_my_org_id());

-- Users: only owners/managers can insert/update/delete users
CREATE POLICY "managers_write_users" ON users
  FOR ALL USING (
    org_id = get_my_org_id()
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('owner','manager')
    )
  );

-- Inventory: full org isolation
CREATE POLICY "inventory_org_isolation" ON inventory_items
  FOR ALL USING (org_id = get_my_org_id());

-- Activity logs: org isolation, read-only for non-service-role
CREATE POLICY "activity_logs_org_isolation" ON activity_logs
  FOR ALL USING (org_id = get_my_org_id());

-- Approval requests: org isolation
CREATE POLICY "approvals_org_isolation" ON approval_requests
  FOR ALL USING (org_id = get_my_org_id());

-- Stock takes: org isolation
CREATE POLICY "stock_takes_org_isolation" ON stock_take_sessions
  FOR ALL USING (org_id = get_my_org_id());

CREATE POLICY "stock_entries_org_isolation" ON stock_take_entries
  FOR ALL USING (org_id = get_my_org_id());

-- Settings: org isolation
CREATE POLICY "settings_org_isolation" ON organization_settings
  FOR ALL USING (org_id = get_my_org_id());

-- Notifications: users see only their own
CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (user_id = auth.uid() OR org_id = get_my_org_id());

-- FCM tokens: users see only their own
CREATE POLICY "fcm_tokens_own" ON fcm_tokens
  FOR ALL USING (user_id = auth.uid());

-- ── Auth trigger: auto-create public.users on sign-up ─────────

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only insert if org_id was passed in metadata (owner sign-up or invite)
  IF NEW.raw_user_meta_data->>'org_id' IS NOT NULL THEN
    INSERT INTO public.users (id, email, full_name, org_id, role)
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ── RPC: create org + owner atomically ───────────────────────
-- Called from the frontend on first sign-up / onboarding

CREATE OR REPLACE FUNCTION create_organization_with_owner(
  p_org_id     UUID,
  p_org_name   TEXT,
  p_org_plan   TEXT,
  p_user_id    UUID,
  p_user_email TEXT,
  p_user_name  TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Insert org
  INSERT INTO organizations (id, name, plan)
  VALUES (p_org_id, p_org_name, p_org_plan)
  ON CONFLICT (id) DO NOTHING;

  -- Insert user row (owner)
  INSERT INTO users (id, org_id, email, full_name, role)
  VALUES (p_user_id, p_org_id, p_user_email, p_user_name, 'owner')
  ON CONFLICT (id) DO UPDATE SET org_id = p_org_id, role = 'owner';

  -- Default settings row
  INSERT INTO organization_settings (org_id)
  VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;
END;
$$;
