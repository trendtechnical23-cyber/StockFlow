/**
 * Supabase service-role client for the Express backend.
 *
 * Uses the SERVICE ROLE key — this bypasses RLS.
 * NEVER expose this key to the frontend.
 *
 * Usage in route files:
 *   const { supabase } = require('../supabaseAdmin');
 *   const { data, error } = await supabase.from('inventory_items').select('*');
 */
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[SUPABASE] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — Supabase routes will fail');
}

const supabase = createClient(
  process.env.SUPABASE_URL        || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  }
);

module.exports = { supabase };
