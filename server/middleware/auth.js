/**
 * Auth middleware — Supabase JWT verification.
 * Replaces the old Firebase Admin token verification.
 *
 * The Supabase JS client verifies the JWT using the project's JWT secret.
 * org_id comes from the public.users table (attached to every session via
 * the user metadata set at sign-up / invite time).
 */
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// Lazy verifier client — only created on first request, not at require() time.
// Node 20 has no native WebSocket global. The Supabase SDK always constructs
// a RealtimeClient, so we must supply the ws package as its transport.
let _verifier = null;
function getVerifier() {
  if (_verifier) return _verifier;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
  _verifier = createClient(url, key, {
    auth:     { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
  return _verifier;
}

// Service-role client for org lookups that bypass RLS
const { supabase: supabaseAdmin } = require('../supabaseAdmin');

/**
 * Verify Supabase access token and attach user + org info to req.user.
 * Drop-in replacement: exported as verifyFirebaseToken so all route files
 * continue to work without changes.
 */
const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: { message: 'Authorization header must be "Bearer <token>"', status: 401 }
      });
    }

    const token = authHeader.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({
        error: { message: 'Token is required', status: 401 }
      });
    }

    // Verify the JWT and get the Supabase auth user
    const { data: { user }, error } = await getVerifier().auth.getUser(token);

    if (error || !user) {
      console.warn('❌ Token verification failed:', error?.message);
      return res.status(401).json({
        error: { message: 'Invalid or expired token', status: 401 }
      });
    }

    // Fetch org_id from public.users (service role bypasses RLS).
    // maybeSingle() returns null data (no error) when the row doesn't exist.
    // single() throws PGRST116 on 0 rows, which silently nulls orgId — fixed here.
    const { data: publicUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('org_id, role, full_name')
      .eq('id', user.id)
      .maybeSingle();

    if (userError) {
      console.warn(`⚠️ public.users lookup error for ${user.email} (${user.id}): ${userError.message}`);
    }
    if (!publicUser) {
      // Try email fallback — handles cases where the UID was re-created
      console.warn(`⚠️ No public.users row for uid=${user.id}, trying email lookup: ${user.email}`);
    }

    const { data: emailUser } = !publicUser
      ? await supabaseAdmin
          .from('users')
          .select('org_id, role, full_name')
          .eq('email', user.email)
          .maybeSingle()
      : { data: null };

    const resolvedUser = publicUser || emailUser;

    req.user = {
      uid:   user.id,
      email: user.email,
      orgId: resolvedUser?.org_id ?? user.user_metadata?.org_id ?? null,
      role:  resolvedUser?.role   ?? user.user_metadata?.role   ?? 'staff',
      roles: resolvedUser?.role ? [resolvedUser.role] : [],
    };

    // Expose the raw token so downstream middleware (attachUserClient) and
    // route handlers can create RLS-enforced user-scoped Supabase clients.
    req.supabaseToken = token;

    console.log(`✅ Token verified for ${req.user.email} (org: ${req.user.orgId})`);
    next();

  } catch (err) {
    // Propagate to the global error handler — it will log + format the response.
    // Using next(err) instead of res.json() keeps the error pipeline consistent
    // and ensures the global handler's Postgres-code mapping runs if needed.
    err.statusCode = err.statusCode || 500;
    err.message    = err.message    || 'Internal server error during authentication';
    next(err);
  }
};

/**
 * Require user to belong to the requested organization.
 * Usage: router.get('/data', verifyFirebaseToken, requireOrg(), handler)
 */
const requireOrg = (orgIdParamName = 'orgId') => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: { message: 'Authentication required', status: 401 } });
  }

  const requestedOrgId = req.params[orgIdParamName] || req.body.orgId || req.user.orgId;

  if (!requestedOrgId) {
    return res.status(400).json({ error: { message: 'Organization ID required', status: 400 } });
  }

  if (!req.user.orgId) {
    return res.status(403).json({ error: { message: 'User not assigned to any organization', status: 403 } });
  }

  if (req.user.orgId !== requestedOrgId) {
    console.warn(`❌ Org mismatch: user ${req.user.email} (${req.user.orgId}) → requested ${requestedOrgId}`);
    return res.status(403).json({ error: { message: 'Access denied: wrong organization', status: 403 } });
  }

  if (!req.body.orgId) req.body.orgId = requestedOrgId;
  next();
};

module.exports = { verifyFirebaseToken, requireOrg };
