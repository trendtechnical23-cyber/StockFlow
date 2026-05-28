/**
 * Supabase service-role client for the Express backend.
 *
 * Uses the SERVICE ROLE key — this bypasses RLS.
 * NEVER expose this key to the frontend.
 *
 * IMPORTANT: Lazy initialization — the client is only created on first use,
 * NOT at require() time. This prevents the module from throwing synchronously
 * when env vars are absent (which would cause safeMount to install a 503
 * handler for every route that imports this module).
 *
 * Railway env vars required:
 *   SUPABASE_URL             = https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = eyJ...  (secret — never expose to frontend)
 */
const { createClient } = require('@supabase/supabase-js');

// Backend clients NEVER need realtime subscriptions — the frontend handles
// all WebSocket/realtime. Disabling it entirely prevents the Supabase SDK
// from attempting to initialise a WebSocket transport on Node 20, which has
// no native WebSocket global and would throw:
//   "Node.js 20 detected without native WebSocket support"
const BACKEND_OPTIONS = {
  auth:     { autoRefreshToken: false, persistSession: false },
  realtime: { enabled: false },
  global:   { headers: { 'X-Client-Info': 'stockflow-backend' } },
};

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      '[SUPABASE ADMIN] Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      'must be set in Railway Variables. ' +
      'Go to Railway → your service → Variables and add them.'
    );
  }

  _client = createClient(url, key, BACKEND_OPTIONS);

  console.log('[SUPABASE ADMIN] Client initialized ✅');
  return _client;
}

// Export a Proxy so callers can still destructure { supabase } and call
// supabase.from(...) etc. — the real client is only instantiated on first call.
const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      return getClient()[prop];
    },
  }
);

module.exports = { supabase };
