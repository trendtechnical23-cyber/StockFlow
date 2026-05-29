/**
 * Notification Worker
 *
 * Architecture:
 *   DB row inserted first (source of truth)
 *   → this worker fires FCM push AFTER the DB write
 *
 * FCM is best-effort delivery. If it fails:
 *   - The DB notification still exists → dashboard / APK sees it on next load
 *   - The error is logged but not re-thrown (non-blocking)
 *
 * Token storage: fcm_tokens table in Supabase.
 *   One row per device. Multiple devices per user are supported.
 *   Tokens are fetched fresh for every send (no local cache).
 *
 * To re-enable Firebase:
 *   1. Set FIREBASE_SERVICE_ACCOUNT_JSON env var (JSON string of service account key)
 *   2. Or place firebase-admin-key.json in /server and set FIREBASE_KEY_PATH
 */

const { supabase } = require('../supabaseAdmin');

// ── Firebase Admin initialisation (graceful — no crash if not configured) ──────
let messaging = null;

function initFirebase() {
  try {
    const admin = require('firebase-admin');

    if (admin.apps.length > 0) {
      messaging = admin.messaging();
      return;
    }

    let credential;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(serviceAccount);
    } else if (process.env.FIREBASE_KEY_PATH) {
      credential = admin.credential.cert(require(process.env.FIREBASE_KEY_PATH));
    } else {
      console.warn('⚠️  FCM: No Firebase credentials configured. Push notifications disabled.');
      return;
    }

    admin.initializeApp({ credential });
    messaging = admin.messaging();
    console.log('✅ Firebase Admin SDK initialized — FCM push enabled');
  } catch (err) {
    console.warn('⚠️  FCM: Firebase Admin init failed:', err.message);
  }
}

initFirebase();

// ── Token helpers ────────────────────────────────────────────────────────────────

/**
 * Fetch all FCM tokens for a list of user UUIDs.
 * Returns [ { userId, token, deviceId } ]
 */
async function getTokensForUsers(userIds) {
  if (!userIds?.length) return [];

  const { data, error } = await supabase
    .from('fcm_tokens')
    .select('user_id, token, device_id')
    .in('user_id', userIds);

  if (error) {
    console.error('❌ FCM token lookup failed:', error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Fetch all FCM tokens for every member of an org.
 */
async function getTokensForOrg(orgId) {
  const { data, error } = await supabase
    .from('fcm_tokens')
    .select('user_id, token, device_id, users!inner(org_id)')
    .eq('users.org_id', orgId);

  if (error) {
    console.error('❌ FCM org-token lookup failed:', error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Remove expired / invalid FCM tokens from the database.
 */
async function pruneInvalidToken(token) {
  const { error } = await supabase
    .from('fcm_tokens')
    .delete()
    .eq('token', token);

  if (error) console.warn('⚠️  Failed to prune invalid FCM token:', error.message);
}

// ── Send helpers ──────────────────────────────────────────────────────────────

/**
 * Send one FCM message to a single device token.
 * All string values — FCM data payload requires string values.
 *
 * @param {string} token
 * @param {{ type: string, title: string, body: string, data?: object }} payload
 */
async function sendToToken(token, { type, title, body, data = {} }) {
  if (!messaging) return false;

  const stringData = {};
  Object.entries({ type, ...data }).forEach(([k, v]) => {
    stringData[k] = String(v ?? '');
  });

  const message = {
    token,
    notification: { title, body },
    data: stringData,
    android: {
      priority: 'high',
      notification: { channelId: getAndroidChannel(type), sound: 'default' },
    },
  };

  try {
    await messaging.send(message);
    return true;
  } catch (err) {
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      await pruneInvalidToken(token);
    } else {
      console.warn(`⚠️  FCM send failed for token ${token.slice(0, 20)}...: ${err.message}`);
    }
    return false;
  }
}

/**
 * Map notification type to Android channel ID (must match StockFlowMessagingService.kt)
 */
function getAndroidChannel(type) {
  const channelMap = {
    approval_pending:         'ch_approval_v3',
    approval_approved:        'ch_approval_v3',
    approved:                 'ch_approval_v3',
    approval_rejected:        'ch_approval_v3',
    rejected:                 'ch_approval_v3',
    stock_adjustment_applied: 'ch_stock_in_out_v3',
    low_stock:                'ch_low_stock_v3',
    stock_take_approved:      'ch_stock_take_v3',
    STOCK_TAKE_START:         'ch_stock_take_v3',
    STOCK_TAKE_END:           'ch_stock_take_v3',
  };
  return channelMap[type] ?? 'ch_general_v3';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Send FCM push notifications to specific users.
 * Silently fails per-token — one bad token doesn't block others.
 *
 * @param {string[]} userIds
 * @param {{ type: string, title: string, body: string, data?: object }} payload
 */
async function sendToUsers(userIds, payload) {
  if (!messaging || !userIds?.length) return;

  const tokens = await getTokensForUsers(userIds);
  if (!tokens.length) {
    console.warn(`⚠️  FCM: no tokens found for ${userIds.length} user(s)`);
    return;
  }

  await Promise.allSettled(tokens.map(t => sendToToken(t.token, payload)));
  console.log(`📱 FCM sent to ${tokens.length} device(s) for ${userIds.length} user(s)`);
}

/**
 * Send FCM push notifications to all org members.
 *
 * @param {string} orgId
 * @param {{ type: string, title: string, body: string, data?: object }} payload
 */
async function sendToOrg(orgId, payload) {
  if (!messaging) return;

  const tokens = await getTokensForOrg(orgId);
  if (!tokens.length) return;

  await Promise.allSettled(tokens.map(t => sendToToken(t.token, payload)));
  console.log(`📢 FCM org broadcast sent to ${tokens.length} device(s) in org ${orgId}`);
}

/**
 * Register or update a device FCM token + device_session row.
 * Called from the APK when a new token is generated or app opens.
 *
 * @param {object} opts
 */
async function registerToken({ orgId, userId, deviceId, platform = 'android', token, appVersion = null, ipAddress = null }) {
  // Upsert FCM token
  const { error: tokenError } = await supabase
    .from('fcm_tokens')
    .upsert(
      {
        org_id:         orgId,
        user_id:        userId,
        device_id:      deviceId,
        platform,
        token,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,device_id' }
    );

  if (tokenError) throw new Error(`Token registration failed: ${tokenError.message}`);

  // Upsert device_session
  const { error: sessionError } = await supabase
    .from('device_sessions')
    .upsert(
      {
        user_id:        userId,
        org_id:         orgId,
        device_id:      deviceId,
        platform,
        app_version:    appVersion,
        last_seen_at:   new Date().toISOString(),
        ip_address:     ipAddress,
        is_online:      true,
        push_enabled:   true,
      },
      { onConflict: 'user_id,device_id' }
    );

  if (sessionError) console.warn('⚠️ Device session upsert failed:', sessionError.message);

  console.log(`✅ FCM token + device session registered for user ${userId} device ${deviceId}`);
}

/**
 * Look up users who have push_enabled = true in their device_session.
 * Filters out users who have disabled push before sending.
 */
async function getPushEnabledTokens(userIds) {
  if (!userIds?.length) return [];

  const { data, error } = await supabase
    .from('fcm_tokens')
    .select('user_id, token, device_id, users!inner(org_id)')
    .in('user_id', userIds);

  if (error) {
    console.error('❌ FCM token lookup failed:', error.message);
    return [];
  }

  // Filter by push_enabled from device_sessions
  const { data: sessions } = await supabase
    .from('device_sessions')
    .select('user_id, device_id, push_enabled')
    .in('user_id', userIds)
    .eq('push_enabled', true);

  const pushEnabledSet = new Set(
    (sessions ?? []).map(s => `${s.user_id}:${s.device_id}`)
  );

  return (data ?? []).filter(t =>
    pushEnabledSet.has(`${t.user_id}:${t.device_id}`)
  );
}

/**
 * Mark a notification_recipient row as push_sent after successful FCM delivery.
 */
async function markPushSent(eventId, userId) {
  await supabase
    .from('notification_recipients')
    .update({ push_sent: true })
    .eq('event_id', eventId)
    .eq('user_id', userId);
}

module.exports = { sendToUsers, sendToOrg, registerToken, markPushSent };
