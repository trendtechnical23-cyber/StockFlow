/**
 * /api/devices — FCM token + device session management (v3 schema)
 *
 * fcm_tokens schema (v3):
 *   org_id UUID NOT NULL
 *   user_id UUID NOT NULL
 *   device_id TEXT NOT NULL        ← new required field
 *   platform TEXT
 *   token TEXT NOT NULL
 *   UNIQUE(user_id, device_id)
 *   UNIQUE(token)
 *
 * device_sessions schema (v3):
 *   user_id, org_id, device_id, platform, app_version,
 *   last_seen_at, ip_address, is_online, push_enabled
 */

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth');
const { supabase }             = require('../supabaseAdmin');
const notificationWorker       = require('../services/notificationWorker');

const router = express.Router();

/**
 * POST /api/devices/register
 *
 * APK body: { orgId, deviceToken, platform, deviceId?, appVersion? }
 *
 * deviceId: stable Android identifier (Settings.Secure.ANDROID_ID from APK).
 * Falls back to a hash of userId+token if APK doesn't send it yet.
 */
router.post('/register', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, deviceToken, platform = 'android', deviceId, appVersion } = req.body;

    if (!orgId || typeof orgId !== 'string')
      return res.status(400).json({ error: { message: 'orgId is required', status: 400 } });
    if (!deviceToken || typeof deviceToken !== 'string')
      return res.status(400).json({ error: { message: 'deviceToken is required', status: 400 } });
    if (req.user.orgId && req.user.orgId !== orgId)
      return res.status(403).json({ error: { message: 'Access denied: wrong organization', status: 403 } });

    // Derive a stable device_id if APK doesn't send one yet.
    // Using token as device_id is acceptable until APK sends ANDROID_ID.
    const stableDeviceId = deviceId || deviceToken.substring(0, 64);

    // Upsert FCM token + device_session atomically via the notification worker
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || null;

    await notificationWorker.registerToken({
      orgId,
      userId:     req.user.uid,
      deviceId:   stableDeviceId,
      platform,
      token:      deviceToken,
      appVersion: appVersion || null,
      ipAddress,
    });

    console.log(`✅ Device registered: ${platform} for ${req.user.email} in org ${orgId}`);

    res.json({
      success: true,
      message: 'Device registered successfully',
      data: { orgId, platform, deviceId: stableDeviceId, userEmail: req.user.email },
    });
  } catch (error) {
    console.error('❌ Error registering device:', error.message);
    res.status(500).json({ error: { message: 'Failed to register device', status: 500 } });
  }
});

/**
 * POST /api/devices/unregister
 * Body: { orgId, deviceToken }
 */
router.post('/unregister', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, deviceToken } = req.body;

    if (!orgId)        return res.status(400).json({ error: { message: 'orgId is required', status: 400 } });
    if (!deviceToken)  return res.status(400).json({ error: { message: 'deviceToken is required', status: 400 } });
    if (req.user.orgId && req.user.orgId !== orgId)
      return res.status(403).json({ error: { message: 'Access denied: wrong organization', status: 403 } });

    // Verify ownership
    const { data: existing } = await supabase
      .from('fcm_tokens')
      .select('id, user_id, device_id')
      .eq('token', deviceToken)
      .maybeSingle();

    if (!existing)
      return res.status(404).json({ error: { message: 'Device token not found', status: 404 } });
    if (existing.user_id !== req.user.uid)
      return res.status(403).json({ error: { message: 'Access denied: not your token', status: 403 } });

    // Remove FCM token
    await supabase.from('fcm_tokens').delete().eq('token', deviceToken);

    // Mark device session offline
    await supabase
      .from('device_sessions')
      .update({ is_online: false })
      .eq('user_id', req.user.uid)
      .eq('device_id', existing.device_id);

    console.log(`✅ Device unregistered for ${req.user.email}`);
    res.json({ success: true, message: 'Device unregistered successfully' });
  } catch (error) {
    console.error('❌ Error unregistering device:', error.message);
    res.status(500).json({ error: { message: 'Failed to unregister device', status: 500 } });
  }
});

/**
 * POST /api/devices/heartbeat
 * APK calls this periodically to keep device_session.last_seen_at fresh.
 * Body: { orgId, deviceId? }
 */
router.post('/heartbeat', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, deviceId } = req.body;
    if (!orgId) return res.status(400).json({ error: { message: 'orgId required', status: 400 } });

    const query = supabase
      .from('device_sessions')
      .update({ last_seen_at: new Date().toISOString(), is_online: true })
      .eq('user_id', req.user.uid);

    if (deviceId) query.eq('device_id', deviceId);

    await query;
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Heartbeat error:', error.message);
    res.status(500).json({ error: { message: 'Heartbeat failed', status: 500 } });
  }
});

module.exports = router;
