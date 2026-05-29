/**
 * /api/mobile — Endpoints consumed exclusively by the Android APK.
 *
 * Schema: 003_enterprise_improvements (v3)
 * - inventory_items has NO quantity column — stock comes from inventory_balances
 * - stock_take_entries uses counted_qty / expected_qty / counted_by / counted_at
 * - notifications table GONE — use fn_notify_managers RPC
 * - users.role renamed to users.legacy_role
 */

const express = require('express');
const router  = express.Router();
const { supabase }            = require('../supabaseAdmin');
const { verifyFirebaseToken } = require('../middleware/auth');

// ── 1. Org resolution ──────────────────────────────────────────────────────────

/**
 * GET /api/mobile/user-org
 */
router.get('/user-org', verifyFirebaseToken, async (req, res) => {
  let { orgId, uid, email, role } = req.user;

  if (!orgId) {
    console.warn(`[user-org] orgId missing for ${email} — running direct lookup`);

    const { data: byUid } = await supabase
      .from('users')
      .select('org_id, legacy_role')   // ← was 'role', now 'legacy_role'
      .eq('id', uid)
      .maybeSingle();

    const { data: byEmail } = !byUid
      ? await supabase.from('users').select('org_id, legacy_role').eq('email', email).maybeSingle()
      : { data: null };

    const row = byUid || byEmail;
    orgId = row?.org_id      ?? null;
    role  = row?.legacy_role ?? role;   // ← was 'row?.role'

    console.warn(`[user-org] direct lookup — byUid:${!!byUid} byEmail:${!!byEmail} orgId:${orgId}`);
  }

  if (!orgId) {
    const { data: orgs } = await supabase.from('organizations').select('id').limit(2);
    if (orgs?.length === 1) {
      orgId = orgs[0].id;
      console.warn(`[user-org] ⚠️  single-org fallback: ${orgId} for ${email}`);
    }
  }

  if (!orgId) {
    console.error(`[user-org] ❌ Could not resolve org for uid=${uid} email=${email}`);
    return res.status(404).json({
      success: false,
      message: 'No organisation linked to this account.',
    });
  }

  res.json({ success: true, data: { orgId, userId: uid, email, role } });
});

// ── 2. Inventory ───────────────────────────────────────────────────────────────

/**
 * GET /api/mobile/inventory?orgId=UUID
 *
 * Returns active items with current stock levels.
 * Stock quantity is read from inventory_balances (NOT inventory_items.quantity).
 */
router.get('/inventory', verifyFirebaseToken, async (req, res) => {
  const orgId = req.query.orgId || req.user.orgId;
  if (!orgId) return res.status(400).json({ success: false, message: 'Missing orgId' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  try {
    // Use the org stock summary RPC — returns items + current_stock from balances
    const { data, error } = await supabase.rpc('rpc_get_org_stock_summary', {
      p_org_id: orgId,
    });

    if (error) throw error;

    // Fetch unit abbreviations for display (separate small query)
    const { data: items, error: itemErr } = await supabase
      .from('inventory_items')
      .select(`
        id, metadata,
        unit:units_of_measure!inventory_items_unit_id_fkey ( abbreviation, name ),
        category:categories!inventory_items_category_id_fkey ( name )
      `)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .is('deleted_at', null);

    if (itemErr) throw itemErr;

    // Build lookup maps for unit/category names
    const unitMap     = {};
    const categoryMap = {};
    (items || []).forEach(i => {
      unitMap[i.id]     = i.unit?.abbreviation ?? i.unit?.name ?? i.metadata?.unit ?? null;
      categoryMap[i.id] = i.category?.name ?? i.metadata?.category ?? null;
    });

    const result = (data || []).map(r => ({
      itemId:            r.item_id,
      name:              r.name,
      sku:               r.sku,
      quantityAvailable: Number(r.current_stock ?? 0),   // APK Room cache field
      unit:              unitMap[r.item_id]     ?? null,
      rate:              r.unit_price           ?? null,  // APK uses 'rate' for unit_price
      minQuantity:       r.minimum_stock        ?? 0,
      category:          categoryMap[r.item_id] ?? null,
      isLowStock:        !!r.is_low_stock,
      isOutOfStock:      !!r.is_out_of_stock,
      isPriority:        !!r.is_priority,
      source:            'supabase',
    }));

    res.json({ success: true, data: { items: result, totalItems: result.length } });
  } catch (err) {
    console.error('[mobile/inventory]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 3. Approval requests ───────────────────────────────────────────────────────

/**
 * POST /api/mobile/approvals
 * Submit a stock-change approval from the APK.
 *
 * Body: { orgId, itemId, itemName, itemSKU, changeType, quantityDelta, reason, deviceName, idempotencyKey? }
 */
router.post('/approvals', verifyFirebaseToken, async (req, res) => {
  const {
    orgId, itemId, itemName, itemSKU,
    changeType, quantityDelta, reason,
    deviceName, idempotencyKey,
  } = req.body;

  const actorId   = req.user.uid;
  const actorName = req.user.email;

  if (!orgId || !itemId || !changeType || quantityDelta == null)
    return res.status(400).json({ success: false, message: 'Missing: orgId, itemId, changeType, quantityDelta' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  const delta = changeType === 'stock_out'
    ? -Math.abs(Number(quantityDelta))
    :  Math.abs(Number(quantityDelta));

  try {
    // Idempotency: if key provided and already exists, return the existing approval
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('approval_requests')
        .select('id')
        .eq('org_id', orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        console.log(`[mobile/approvals] idempotent return for key=${idempotencyKey}`);
        return res.json({ success: true, message: 'Approval request submitted', data: { approvalId: existing.id } });
      }
    }

    // Insert approval request (v3 schema)
    const { data: approval, error: approvalErr } = await supabase
      .from('approval_requests')
      .insert({
        org_id:          orgId,
        type:            'stock_adjustment',
        reference_type:  'apk',
        item_id:         itemId,
        delta,
        reason:          reason || `${changeType === 'stock_in' ? 'Stock In' : 'Stock Out'} via mobile`,
        requested_by:    actorId,
        status:          'pending',
        idempotency_key: idempotencyKey || null,
        metadata: {
          source:     'apk',
          deviceName: deviceName || null,
          itemName:   itemName   || null,
          itemSKU:    itemSKU    || null,
          changeType,
        },
      })
      .select('id')
      .single();

    if (approvalErr) throw approvalErr;

    // Notify managers via new split-notification RPC
    // fn_notify_managers inserts notification_events + notification_recipients rows
    const { error: notifErr } = await supabase.rpc('fn_notify_managers', {
      p_org_id: orgId,
      p_type:   'approval_pending',
      p_title:  '🔔 Approval Required',
      p_body:   `${actorName} (${deviceName || 'Mobile'}) requested ${delta > 0 ? '+' : ''}${delta} units for ${itemName || itemSKU || 'an item'}.`,
      p_data:   {
        approvalId: approval.id,
        itemId, itemName, itemSKU,
        changeType, delta,
        source: 'apk',
      },
    });

    if (notifErr) console.warn('[mobile/approvals] notification insert failed:', notifErr.message);

    // Activity log
    await supabase.from('activity_logs').insert({
      org_id:      orgId,
      user_id:     actorId,
      action:      changeType === 'stock_in' ? 'submit_stock_in' : 'submit_stock_out',
      entity_type: 'approval_request',
      entity_id:   approval.id,
      details: { itemName, itemSKU, changeType, delta, reason, deviceName, source: 'apk' },
    });

    res.json({ success: true, message: 'Approval request submitted', data: { approvalId: approval.id } });
  } catch (err) {
    console.error('[mobile/approvals]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4. Activity logging ────────────────────────────────────────────────────────

/**
 * POST /api/mobile/activity
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
      user_id:     actorId,
      action:      action || type,
      entity_type: itemId ? 'inventory_item' : null,
      entity_id:   itemId || null,
      details:     { itemName: itemName || null, quantity: quantity ?? null, source: 'apk', ...(details || {}) },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[mobile/activity]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 5. Stock take ──────────────────────────────────────────────────────────────

/**
 * GET /api/mobile/stock-take/sessions?orgId=UUID
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
      .in('status', ['open', 'counting'])
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
 *
 * v3 schema column names:
 *   counted_qty   (was counted_quantity)
 *   expected_qty  (was expected_quantity)
 *   counted_by    (was scanned_by)
 *   counted_at    (was scanned_at)
 *   NO sku column on stock_take_entries
 *
 * Body: { orgId, sessionId, itemId, sku, itemName, countedQuantity, expectedQuantity, idempotencyKey? }
 */
router.post('/stock-take/scan', verifyFirebaseToken, async (req, res) => {
  const {
    orgId, sessionId, itemId,
    countedQuantity, expectedQuantity,
    idempotencyKey,
  } = req.body;

  const countedBy = req.user.uid;

  if (!orgId || !sessionId || countedQuantity == null)
    return res.status(400).json({ success: false, message: 'Missing: orgId, sessionId, countedQuantity' });
  if (req.user.orgId && req.user.orgId !== orgId)
    return res.status(403).json({ success: false, message: 'Access denied' });

  try {
    // Upsert with v3 column names (variance is a GENERATED column — do NOT include it)
    const { error } = await supabase
      .from('stock_take_entries')
      .upsert(
        {
          session_id:      sessionId,
          org_id:          orgId,
          item_id:         itemId   || null,
          counted_qty:     Number(countedQuantity),
          expected_qty:    expectedQuantity != null ? Number(expectedQuantity) : 0,
          counted_by:      countedBy,
          counted_at:      new Date().toISOString(),
          idempotency_key: idempotencyKey || null,
        },
        {
          // location_id is NULL for APK scans — NULLS NOT DISTINCT handles the conflict
          onConflict: 'session_id,item_id',
          ignoreDuplicates: false,
        }
      );

    if (error) throw error;

    // Activity log
    await supabase.from('activity_logs').insert({
      org_id:      orgId,
      user_id:     countedBy,
      action:      'stock_take_scan',
      entity_type: 'inventory_item',
      entity_id:   itemId || null,
      details: {
        sessionId,
        countedQty:   Number(countedQuantity),
        expectedQty:  expectedQuantity != null ? Number(expectedQuantity) : 0,
        variance:     Number(countedQuantity) - (expectedQuantity != null ? Number(expectedQuantity) : 0),
        source:       'apk',
      },
    });

    res.json({ success: true, message: 'Scan recorded' });
  } catch (err) {
    console.error('[mobile/stock-take/scan]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 6. FCM token management ────────────────────────────────────────────────────

/**
 * DELETE /api/mobile/fcm-token
 */
router.delete('/fcm-token', verifyFirebaseToken, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });

  try {
    await supabase.from('fcm_tokens').delete().eq('token', token);

    // Mark device_session offline
    await supabase
      .from('device_sessions')
      .update({ is_online: false })
      .eq('user_id', req.user.uid);

    res.json({ success: true });
  } catch (err) {
    console.error('[mobile/fcm-token DELETE]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
