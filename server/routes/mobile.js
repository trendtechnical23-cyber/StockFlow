/**
 * /api/mobile — Endpoints consumed exclusively by the Android APK.
 *
 * Every route is protected by verifyFirebaseToken (Supabase JWT).
 * The middleware resolves req.user.orgId from public.users so handlers
 * don't need a second lookup.
 *
 * What this replaces in the APK:
 *   • Firestore reads/writes (inventory, approvals, notifications, sessions)
 *   • Realtime Database reads/writes (stock-take sessions)
 *   • Direct Firebase Auth token fetching
 */

const express = require('express');
const router  = express.Router();
const { supabase }            = require('../supabaseAdmin');
const { verifyFirebaseToken } = require('../middleware/auth');

// ── 1. Org resolution ─────────────────────────────────────────────────────────

/**
 * GET /api/mobile/user-org
 * Returns the org UUID for the authenticated user.
 * APK calls this once right after Supabase login to resolve the org.
 */
router.get('/user-org', verifyFirebaseToken, async (req, res) => {
  let { orgId, uid, email, role } = req.user;

  // Auth middleware already tried UID + email fallback.
  // If orgId is still null do one final direct lookup so a misconfigured
  // middleware never silently blocks a valid user.
  if (!orgId) {
    console.warn(`[user-org] orgId missing for ${email} — running direct lookup`);
    const { data: row } = await supabase
      .from('users')
      .select('org_id, role')
      .or(`id.eq.${uid},email.eq.${email}`)
      .maybeSingle();

    orgId = row?.org_id ?? null;
    role  = row?.role   ?? role;

    if (orgId) {
      console.log(`[user-org] ✅ Resolved org ${orgId} via direct lookup for ${email}`);
    }
  }

  if (!orgId) {
    console.error(`[user-org] ❌ Could not resolve org for uid=${uid} email=${email}`);
    return res.status(404).json({
      success: false,
      message: 'No organisation linked to this account. Ask your administrator to check your user record in Supabase.',
    });
  }

  res.json({ success: true, data: { orgId, userId: uid, email, role } });
});

// ── 2. Inventory ──────────────────────────────────────────────────────────────

/**
 * GET /api/mobile/inventory?orgId=UUID
 * All active inventory items for the org, shaped for the APK's Room cache.
 */
router.get('/inventory', verifyFirebaseToken, async (req, res) => {
  const orgId = req.query.orgId || req.user.orgId;
  if (!orgId) return res.status(400).json({ success: false, message: 'Missing orgId' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  try {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, sku, name, quantity, min_quantity, unit_price, unit, category, source, is_active')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    const items = (data || []).map(r => ({
      itemId:            r.id,
      name:              r.name,
      sku:               r.sku,
      quantityAvailable: r.quantity     ?? 0,
      unit:              r.unit         ?? null,
      rate:              r.unit_price   ?? null,
      minQuantity:       r.min_quantity ?? 10,
      category:          r.category     ?? null,
      source:            r.source       ?? 'manual',
    }));

    res.json({ success: true, data: { items, totalItems: items.length } });
  } catch (err) {
    console.error('[mobile/inventory]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 3. Approval requests ──────────────────────────────────────────────────────

/**
 * POST /api/mobile/approvals
 * Submit a stock-change approval from the APK (stock_in or stock_out).
 * Inventory is NOT updated until a dashboard admin approves.
 *
 * Body: { orgId, itemId, itemName, itemSKU, changeType, quantityDelta, reason, deviceName }
 */
router.post('/approvals', verifyFirebaseToken, async (req, res) => {
  const { orgId, itemId, itemName, itemSKU, changeType, quantityDelta, reason, deviceName } = req.body;
  const actorId   = req.user.uid;
  const actorName = req.user.email;

  if (!orgId || !itemId || !changeType || quantityDelta == null)
    return res.status(400).json({ success: false, message: 'Missing required fields: orgId, itemId, changeType, quantityDelta' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  const delta = changeType === 'stock_out' ? -Math.abs(Number(quantityDelta)) : Math.abs(Number(quantityDelta));

  try {
    // Insert approval request
    const { data: approval, error: approvalErr } = await supabase
      .from('approval_requests')
      .insert({
        org_id:       orgId,
        type:         'stock_adjustment',
        item_id:      itemId,
        delta,
        reason:       reason || `${changeType === 'stock_in' ? 'Stock In' : 'Stock Out'} via mobile app`,
        requested_by: actorId,
        status:       'pending',
      })
      .select('id')
      .single();

    if (approvalErr) throw approvalErr;

    // Dashboard notification
    await supabase.from('notifications').insert({
      org_id:  orgId,
      title:   'Approval Required',
      body:    `${actorName} (${deviceName || 'Mobile'}) requested ${delta > 0 ? '+' : ''}${delta} units for ${itemName || itemSKU}.`,
      type:    'approval_pending',
      data:    { approvalId: approval.id, itemId, itemName, itemSKU, changeType, quantityDelta: delta, source: 'mobile_app' },
      is_read: false,
    });

    // Activity log
    await supabase.from('activity_logs').insert({
      org_id:      orgId,
      type:        changeType === 'stock_in' ? 'stock_in' : 'stock_out',
      entity_type: 'inventory',
      entity_id:   itemId,
      actor_id:    actorId,
      details: { itemName, itemSKU, changeType, delta, reason, deviceName, approvalId: approval.id, source: 'apk', status: 'pending_approval' },
    });

    res.json({ success: true, message: 'Approval request submitted', data: { approvalId: approval.id } });
  } catch (err) {
    console.error('[mobile/approvals]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4. Activity logging ───────────────────────────────────────────────────────

/**
 * POST /api/mobile/activity
 * Log an activity from the APK to the dashboard activity feed.
 *
 * Body: { orgId, type, itemId?, itemName?, quantity?, action, details? }
 */
router.post('/activity', verifyFirebaseToken, async (req, res) => {
  const { orgId, type, itemId, itemName, quantity, action, details } = req.body;
  const actorId = req.user.uid;

  if (!orgId || !type)
    return res.status(400).json({ success: false, message: 'Missing orgId or type' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  try {
    await supabase.from('activity_logs').insert({
      org_id:      orgId,
      type:        type || 'scan',
      entity_type: itemId ? 'inventory' : null,
      entity_id:   itemId   || null,
      actor_id:    actorId,
      details: { itemName: itemName || null, quantity: quantity ?? null, action: action || null, source: 'apk', ...(details || {}) },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[mobile/activity]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 5. Stock take ─────────────────────────────────────────────────────────────

/**
 * GET /api/mobile/stock-take/sessions?orgId=UUID
 * Active (status = 'open') sessions — APK shows these on the stock-take screen.
 */
router.get('/stock-take/sessions', verifyFirebaseToken, async (req, res) => {
  const orgId = req.query.orgId || req.user.orgId;
  if (!orgId) return res.status(400).json({ success: false, message: 'Missing orgId' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  try {
    const { data, error } = await supabase
      .from('stock_take_sessions')
      .select('id, name, status, started_at, started_by')
      .eq('org_id', orgId)
      .eq('status', 'open')
      .order('started_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: { sessions: data || [] } });
  } catch (err) {
    console.error('[mobile/stock-take/sessions]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/mobile/stock-take/scan
 * Record one stock-take scan entry from the APK.
 * Uses upsert on (session_id, item_id) so re-scanning overwrites the previous count.
 *
 * Body: { orgId, sessionId, itemId, sku, itemName, countedQuantity, expectedQuantity }
 */
router.post('/stock-take/scan', verifyFirebaseToken, async (req, res) => {
  const { orgId, sessionId, itemId, sku, itemName, countedQuantity, expectedQuantity } = req.body;
  const scannedBy = req.user.uid;

  if (!orgId || !sessionId || countedQuantity == null)
    return res.status(400).json({ success: false, message: 'Missing required: orgId, sessionId, countedQuantity' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  try {
    const { error } = await supabase.from('stock_take_entries').upsert(
      {
        session_id:        sessionId,
        org_id:            orgId,
        item_id:           itemId || null,
        sku:               sku    || null,
        counted_quantity:  Number(countedQuantity),
        expected_quantity: expectedQuantity != null ? Number(expectedQuantity) : null,
        scanned_by:        scannedBy,
        scanned_at:        new Date().toISOString(),
      },
      { onConflict: 'session_id,item_id' },
    );
    if (error) throw error;

    // Activity log
    await supabase.from('activity_logs').insert({
      org_id:      orgId,
      type:        'scan',
      entity_type: 'inventory',
      entity_id:   itemId || null,
      actor_id:    scannedBy,
      details: {
        sessionId, sku, itemName,
        countedQuantity: Number(countedQuantity),
        expectedQuantity: expectedQuantity != null ? Number(expectedQuantity) : null,
        variance: Number(countedQuantity) - (expectedQuantity != null ? Number(expectedQuantity) : 0),
        source: 'apk',
      },
    });

    res.json({ success: true, message: 'Scan recorded' });
  } catch (err) {
    console.error('[mobile/stock-take/scan]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 6. FCM token management ───────────────────────────────────────────────────

/**
 * DELETE /api/mobile/fcm-token
 * Remove FCM token on logout so push notifications stop going to this device.
 * Body: { token }
 */
router.delete('/fcm-token', verifyFirebaseToken, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });

  try {
    await supabase.from('fcm_tokens').delete().eq('token', token);
    res.json({ success: true });
  } catch (err) {
    console.error('[mobile/fcm-token DELETE]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
