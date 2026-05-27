const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const { supabase } = require('../supabaseAdmin');

const router = express.Router();

/**
 * POST /api/devices/register
 * Register FCM token for push notifications
 */
router.post('/register', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, deviceToken, platform } = req.body;

    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({ error: { message: 'orgId is required', status: 400 } });
    }
    if (!deviceToken || typeof deviceToken !== 'string') {
      return res.status(400).json({ error: { message: 'deviceToken is required', status: 400 } });
    }
    if (!platform || typeof platform !== 'string') {
      return res.status(400).json({ error: { message: 'platform is required', status: 400 } });
    }
    if (req.user.orgId !== orgId) {
      return res.status(403).json({ error: { message: 'Access denied: wrong organization', status: 403 } });
    }

    // Upsert token into fcm_tokens table
    const { error } = await supabase
      .from('fcm_tokens')
      .upsert(
        {
          user_id: req.user.uid,
          token: deviceToken,
          device_name: platform,
          last_active_at: new Date().toISOString(),
        },
        { onConflict: 'token' }
      );

    if (error) throw error;

    console.log(`✅ Device registered: ${platform} token for ${req.user.email} in org ${orgId}`);

    res.json({
      success: true,
      message: 'Device registered successfully',
      data: { orgId, platform, userEmail: req.user.email, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('❌ Error registering device:', error.message);
    res.status(500).json({ error: { message: 'Failed to register device', status: 500 } });
  }
});

/**
 * POST /api/devices/unregister
 * Unregister FCM token
 */
router.post('/unregister', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, deviceToken } = req.body;

    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({ error: { message: 'orgId is required', status: 400 } });
    }
    if (!deviceToken || typeof deviceToken !== 'string') {
      return res.status(400).json({ error: { message: 'deviceToken is required', status: 400 } });
    }
    if (req.user.orgId !== orgId) {
      return res.status(403).json({ error: { message: 'Access denied: wrong organization', status: 403 } });
    }

    // Verify token belongs to user
    const { data: existing } = await supabase
      .from('fcm_tokens')
      .select('id, user_id')
      .eq('token', deviceToken)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ error: { message: 'Device token not found', status: 404 } });
    }
    if (existing.user_id !== req.user.uid) {
      return res.status(403).json({ error: { message: 'Access denied: not your token', status: 403 } });
    }

    const { error } = await supabase.from('fcm_tokens').delete().eq('token', deviceToken);
    if (error) throw error;

    console.log(`✅ Device unregistered for ${req.user.email} in org ${orgId}`);

    res.json({
      success: true,
      message: 'Device unregistered successfully',
      data: { orgId, userEmail: req.user.email, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('❌ Error unregistering device:', error.message);
    res.status(500).json({ error: { message: 'Failed to unregister device', status: 500 } });
  }
});

module.exports = router;
