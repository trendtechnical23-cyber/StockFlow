/**
 * Per-request Supabase user client for the Express backend.
 *
 * Why this exists:
 *   supabaseAdmin.js uses the SERVICE ROLE key — it bypasses RLS entirely.
 *   That is correct for admin operations (creating users, server-side jobs).
 *   But for endpoints where you want RLS to apply (e.g. data reads on behalf
 *   of the logged-in user), you need a client that presents the user's JWT
 *   so Postgres RLS policies can enforce org isolation.
 *
 * Usage in route handlers:
 *   const { getUserClient } = require('../supabaseUser');
 *
 *   router.get('/my-data', verifyFirebaseToken, async (req, res) => {
 *     // req.supabaseToken is set by the auth middleware
 *     const client = getUserClient(req.supabaseToken);
 *     const { data, error } = await client.from('inventory_items').select('*');
 *     // ↑ RLS: only returns rows matching the user's org_id
 *   });
 *
 * Pattern from SDK source (SupabaseClient.ts):
 *   Pass `global.headers` with the Authorization header so every request
 *   from this client carries the user's JWT without calling getSession().
 *
 * Railway env vars required:
 *   SUPABASE_URL      = https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY = eyJ...  (publishable — safe to include in requests)
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

/**
 * Create a Supabase client scoped to the authenticated user.
 *
 * The client uses the ANON key + the user's JWT as an Authorization header.
 * Supabase's PostgREST layer will honour the JWT's `sub` claim for RLS.
 *
 * @param {string} accessToken - The user's Supabase JWT (from req.supabaseToken)
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function getUserClient(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      '[SUPABASE USER] Missing env vars: SUPABASE_URL and SUPABASE_ANON_KEY ' +
      'must be set in Railway Variables.'
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth:     { autoRefreshToken: false, persistSession: false },
    realtime: { enabled: false },
    global:   { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Express middleware that attaches a user-scoped Supabase client to req.
 * Requires verifyFirebaseToken (actually verifySupabaseToken) to run first,
 * which must set req.supabaseToken.
 *
 * After this middleware runs: req.userSupabase is a RLS-enforced client.
 *
 * @example
 *   router.get('/items', verifyFirebaseToken, attachUserClient, async (req, res) => {
 *     const { data } = await req.userSupabase.from('inventory_items').select('*');
 *   });
 */
function attachUserClient(req, res, next) {
  const token = req.supabaseToken || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No access token — cannot create user-scoped client' });
  }
  try {
    req.userSupabase = getUserClient(token);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { getUserClient, attachUserClient };
