/**
 * Push Notification Routes
 * FCM tokens are stored in the Supabase fcm_tokens table.
 * Actual FCM message delivery requires a valid Firebase project —
 * if no project is configured, send endpoints return 503 gracefully.
 */

const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth');
const { supabase } = require('../supabaseAdmin');

// ── Helper: list FCM tokens for an org via Supabase ──────────────────────────
async function getOrgTokens(orgId) {
  const { data, error } = await supabase
    .from('fcm_tokens')
    .select('token, user_id, device_name, last_active_at, users!inner(org_id)')
    .eq('users.org_id', orgId);
  if (error) throw error;
  return data || [];
}

// ── Notification stub ─────────────────────────────────────────────────────────
// Firebase project has been removed. Sending FCM messages is not available.
function fcmUnavailable(res) {
  return res.status(503).json({
    success: false,
    error: 'Push notification service is not configured',
    reason: 'FCM requires a Firebase project. Contact admin to configure push notifications.',
  });
}

/**
 * POST /api/fcm/test-notify/:userId
 */
router.post('/test-notify/:userId', verifyFirebaseToken, (req, res) => fcmUnavailable(res));

/**
 * POST /api/fcm/send-to-user
 */
router.post('/send-to-user', verifyFirebaseToken, (req, res) => fcmUnavailable(res));

/**
 * POST /api/fcm/send-to-organization
 */
router.post('/send-to-organization', verifyFirebaseToken, (req, res) => fcmUnavailable(res));

/**
 * POST /api/fcm/send-to-topic
 */
router.post('/send-to-topic', verifyFirebaseToken, (req, res) => fcmUnavailable(res));

/**
 * GET /api/fcm/stats/:orgId
 */
router.get('/stats/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;
    const tokens = await getOrgTokens(orgId);
    res.json({ success: true, orgId, tokenCount: tokens.length });
  } catch (error) {
    console.error('❌ FCM stats error:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/fcm/listener-status
 */
router.get('/listener-status', (req, res) => {
  res.json({ success: true, status: { active: false, reason: 'Realtime listeners run via Supabase channels on the client' } });
});

/**
 * POST /api/fcm/start-listeners  (no-op)
 */
router.post('/start-listeners', (req, res) => {
  res.json({ success: true, message: 'Listeners are managed by Supabase Realtime on the client side' });
});

/**
 * POST /api/fcm/stop-listeners  (no-op)
 */
router.post('/stop-listeners', (req, res) => {
  res.json({ success: true, message: 'Listeners are managed by Supabase Realtime on the client side' });
});

/**
 * GET /api/fcm/tokens/:orgId
 * List FCM tokens for an organization
 */
router.get('/tokens/:orgId', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization ID is required' });
    }
    const tokens = await getOrgTokens(orgId);
    res.json({ success: true, orgId, count: tokens.length, tokens });
  } catch (error) {
    console.error('❌ Error listing FCM tokens:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
