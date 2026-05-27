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
const ws = require('ws');

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

  // Node.js < 22 has no native WebSocket — pass the ws package so the
  // Supabase client does not throw "Node.js 20 detected without native WebSocket".
  _client = createClient(url, key, {
    auth:     { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });

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
