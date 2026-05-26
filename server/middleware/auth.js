/**
 * Auth middleware — Supabase JWT verification.
 * Replaces the old Firebase Admin token verification.
 *
 * The Supabase JS client verifies the JWT using the project's JWT secret.
 * org_id comes from the public.users table (attached to every session via
 * the user metadata set at sign-up / invite time).
 */
const { createClient } = require('@supabase/supabase-js');

// Use the anon key for token verification (getUser validates the Bearer token)
const supabaseVerifier = createClient(
  process.env.SUPABASE_URL       || '',
  process.env.SUPABASE_ANON_KEY  || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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
    const { data: { user }, error } = await supabaseVerifier.auth.getUser(token);

    if (error || !user) {
      console.warn('❌ Token verification failed:', error?.message);
      return res.status(401).json({
        error: { message: 'Invalid or expired token', status: 401 }
      });
    }

    // Fetch org_id from public.users (service role bypasses RLS)
    const { data: publicUser, error: userError } = await supabaseAdmin
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single();

    if (userError || !publicUser) {
      console.warn(`⚠️ No public.users record for ${user.email} (${user.id})`);
    }

    req.user = {
      uid:   user.id,
      email: user.email,
      orgId: publicUser?.org_id ?? user.user_metadata?.org_id ?? null,
      role:  publicUser?.role   ?? user.user_metadata?.role   ?? 'staff',
      roles: publicUser?.role ? [publicUser.role] : [],
    };

    console.log(`✅ Token verified for ${req.user.email} (org: ${req.user.orgId})`);
    next();

  } catch (err) {
    console.error('❌ Auth middleware error:', err.message);
    return res.status(500).json({
      error: { message: 'Internal server error during authentication', status: 500 }
    });
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
