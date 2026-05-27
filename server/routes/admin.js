const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const { supabase } = require('../supabaseAdmin');

const router = express.Router();

/**
 * POST /api/admin/setUserOrg
 * Assign a user to an organization (updates public.users row)
 */
router.post('/setUserOrg', verifyFirebaseToken, async (req, res) => {
  try {
    const { uid, orgId } = req.body;

    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: { message: 'uid is required and must be a string', status: 400 } });
    }
    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({ error: { message: 'orgId is required and must be a string', status: 400 } });
    }

    // Authorization: must be admin org or bootstrap secret
    const adminOrgId = process.env.ADMIN_ORG_ID;
    const isAdminUser = adminOrgId && req.user.orgId && req.user.orgId === adminOrgId;
    const adminSecret = process.env.ADMIN_SECRET;
    const isBootstrapRequest = adminSecret && req.headers['x-admin-secret'] === adminSecret;

    if (!isAdminUser && !isBootstrapRequest) {
      console.warn(`❌ Unauthorized setUserOrg attempt by: ${req.user.email}`);
      return res.status(403).json({ error: { message: 'Access denied: Admin privileges required', status: 403 } });
    }

    // Verify target user exists in public.users
    const { data: targetUser, error: lookupError } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', uid)
      .maybeSingle();

    if (lookupError || !targetUser) {
      return res.status(404).json({ error: { message: 'User not found', status: 404 } });
    }

    // Update org_id
    const { error: updateError } = await supabase
      .from('users')
      .update({ org_id: orgId, updated_at: new Date().toISOString() })
      .eq('id', uid);

    if (updateError) throw updateError;

    console.log(`✅ User org updated: ${targetUser.email} → org ${orgId} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'User organization updated successfully',
      data: { uid, email: targetUser.email, orgId, updatedBy: req.user.email, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('❌ Error setting user organization:', error.message);
    res.status(500).json({ error: { message: 'Failed to update user organization', status: 500 } });
  }
});

/**
 * POST /api/admin/createUser
 * Invite a new user via Supabase (server-side invite — does not log out the caller)
 */
router.post('/createUser', verifyFirebaseToken, async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: { message: 'email is required', status: 400 } });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: { message: 'password must be at least 6 characters', status: 400 } });
    }
    if (!req.user?.uid) {
      return res.status(403).json({ error: { message: 'Authentication required', status: 403 } });
    }

    // Verify caller is owner/manager
    const callerOrgId = req.user.orgId;
    if (!callerOrgId) {
      return res.status(403).json({ error: { message: 'No organization context', status: 403 } });
    }

    const { data: callerData } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.uid)
      .maybeSingle();

    const callerRole = (callerData?.role || '').toLowerCase();
    if (!['owner', 'manager', 'admin'].includes(callerRole)) {
      console.warn(`❌ Non-admin user ${req.user.email} (role: ${callerRole}) attempted createUser`);
      return res.status(403).json({ error: { message: 'Admin or Owner role required', status: 403 } });
    }

    // Create user via Supabase Admin (admin.auth.createUser)
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password,
      user_metadata: {
        full_name: displayName || email.split('@')[0],
        org_id: callerOrgId,
        role: 'staff',
      },
      email_confirm: true,
    });

    if (createError) {
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        return res.status(409).json({ error: { message: 'An account with this email already exists', status: 409 } });
      }
      throw createError;
    }

    console.log(`✅ User created: ${newUser.user.email} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      user: {
        uid: newUser.user.id,
        email: newUser.user.email,
        displayName: displayName || email.split('@')[0],
      },
    });
  } catch (error) {
    console.error('❌ Failed to create user:', error.message);
    res.status(500).json({ error: { message: 'Failed to create user', status: 500 } });
  }
});

/**
 * DELETE /api/admin/deleteUser
 * Delete a user from Supabase Auth and public.users
 */
router.delete('/deleteUser', verifyFirebaseToken, async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid || typeof uid !== 'string') {
      return res.status(400).json({ error: { message: 'uid is required', status: 400 } });
    }
    if (!req.user?.uid) {
      return res.status(403).json({ error: { message: 'Authentication required', status: 403 } });
    }

    const callerOrgId = req.user.orgId;
    if (!callerOrgId) {
      return res.status(403).json({ error: { message: 'No organization context', status: 403 } });
    }

    const { data: callerData } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.uid)
      .maybeSingle();

    const callerRole = (callerData?.role || '').toLowerCase();
    if (!['owner', 'manager', 'admin'].includes(callerRole)) {
      console.warn(`❌ Non-admin user ${req.user.email} attempted deleteUser`);
      return res.status(403).json({ error: { message: 'Admin or Owner role required', status: 403 } });
    }

    // Delete from Supabase Auth (cascades to public.users via FK)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(uid);
    if (deleteError) {
      if (deleteError.message?.includes('not found')) {
        return res.status(404).json({ error: { message: 'User not found', status: 404 } });
      }
      throw deleteError;
    }

    console.log(`✅ User deleted: ${uid} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'User deleted successfully',
      data: { uid, deletedBy: req.user.email, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('❌ Failed to delete user:', error.message);
    res.status(500).json({ error: { message: 'Failed to delete user', status: 500 } });
  }
});

module.exports = router;
