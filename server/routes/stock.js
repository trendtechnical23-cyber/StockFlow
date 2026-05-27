const express = require('express');
const { verifyFirebaseToken, requireOrg } = require('../middleware/auth');
const { supabase } = require('../supabaseAdmin');

const router = express.Router();

/**
 * POST /api/stock/update
 * Update stock quantity for an item
 */
router.post('/update', verifyFirebaseToken, requireOrg('orgId'), async (req, res) => {
  try {
    console.log('📦 Stock update request received:', req.body);
    let { orgId, itemId, qtyChange, reason, quantity, operation } = req.body;

    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: { message: 'itemId is required and must be a string', status: 400 } });
    }

    // Fetch current item from Supabase
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', itemId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!currentItem) {
      return res.status(404).json({ error: { message: 'Item not found in inventory', status: 404 } });
    }

    const currentQty = currentItem.quantity || 0;

    // Support legacy payloads: quantity/operation → derive qtyChange
    if ((quantity !== undefined && quantity !== null) || operation) {
      if (!operation) operation = 'set';
      if (operation === 'set') {
        qtyChange = (typeof quantity === 'number' ? quantity : currentQty) - currentQty;
      } else if (operation === 'add') {
        qtyChange = Math.abs(typeof quantity === 'number' ? quantity : 0);
      } else if (operation === 'subtract') {
        qtyChange = -Math.abs(typeof quantity === 'number' ? quantity : 0);
      }
    }

    if (typeof qtyChange !== 'number' || isNaN(qtyChange)) {
      return res.status(400).json({ error: { message: 'qtyChange is required and must be a valid number', status: 400 } });
    }
    if (qtyChange === 0) {
      return res.status(400).json({ error: { message: 'qtyChange cannot be zero', status: 400 } });
    }

    const newQty = currentQty + qtyChange;
    if (newQty < 0) {
      return res.status(400).json({ error: { message: 'Insufficient stock for this operation', status: 400 } });
    }

    // Update inventory item
    const { data: updatedItem, error: updateError } = await supabase
      .from('inventory_items')
      .update({ quantity: newQty, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('org_id', orgId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Log activity
    await supabase.from('activity_logs').insert({
      org_id: orgId,
      type: 'stock_update',
      entity_type: 'inventory',
      entity_id: itemId,
      actor_id: req.user.uid,
      details: {
        item_name: currentItem.name || 'Unknown Item',
        sku: currentItem.sku,
        change: { from: currentQty, to: newQty, delta: qtyChange },
        reason: reason || null,
        user_email: req.user.email,
      },
    });

    console.log(`✅ Stock updated: ${itemId} in org ${orgId}, change: ${qtyChange}, new qty: ${newQty}, by: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Stock updated successfully',
      data: {
        item: updatedItem,
        change: { qtyChange, reason: reason || null, updatedBy: req.user.email, timestamp: new Date().toISOString() },
      },
    });
  } catch (error) {
    console.error('❌ Error updating stock:', error.message);
    res.status(500).json({ error: { message: 'Failed to update stock', status: 500 } });
  }
});

module.exports = router;
