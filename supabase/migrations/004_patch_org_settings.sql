-- ================================================================
-- StockFlow Patch 004 — Restore integration columns on organization_settings
--
-- The 003 migration was too aggressive in removing JSONB columns.
-- Core settings (currency, timezone, thresholds) are correctly structured.
-- But integration config (Zoho tokens/credentials) and notification prefs
-- are genuinely dynamic blobs — they belong as JSONB.
--
-- This patch adds them back so all existing backend + frontend code works.
-- ================================================================

-- Zoho credentials + OAuth tokens (complex dynamic blob — JSONB is correct here)
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS zoho_config JSONB NOT NULL DEFAULT '{}';

-- Per-user/org notification preferences + onboarding state
-- Keeping as JSONB for flexibility; add onboarding_completed as a proper column too
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}';

-- Explicit boolean for onboarding so it can be queried/indexed without JSONB ops
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

-- POS integration config (frontend may query this too)
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS pos_config JSONB NOT NULL DEFAULT '{}';

-- PayFast / billing config
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS payfast_config JSONB NOT NULL DEFAULT '{}';

-- Migrate any zoho data already stored in organizations.integrations → organization_settings
-- (safe no-op if integrations is empty — uses jsonb_extract_path_text to avoid errors)
UPDATE organization_settings os
SET zoho_config = COALESCE(
  (SELECT integrations->'zoho' FROM organizations WHERE id = os.org_id),
  '{}'::jsonb
)
WHERE zoho_config = '{}'
  AND EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = os.org_id
      AND o.integrations->'zoho' IS NOT NULL
      AND o.integrations->'zoho' != 'null'::jsonb
  );

-- Index for fast zoho_config status lookups (dashboard integration status indicator)
CREATE INDEX IF NOT EXISTS idx_org_settings_zoho_status
  ON organization_settings ((zoho_config->>'status'))
  WHERE zoho_config->>'status' IS NOT NULL;
