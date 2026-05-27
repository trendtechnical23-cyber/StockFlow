/**
 * Priority stock check route.
 * Uses Supabase to find items below minimum quantity and log alerts.
 */
const express = require('express');
const router = express.Router();
const { supabase } = require('../supabaseAdmin');

router.post('/check-stock', async (req, res) => {
  try {
    const { orgId } = req.body;

    if (!orgId) {
      // Run for all orgs if no specific org provided
      const { data: items, error } = await supabase
        .from('inventory_items')
        .select('id, org_id, name, sku, quantity, min_quantity')
        .eq('is_active', true)
        .eq('is_priority', true)
        .filter('quantity', 'lt', supabase.raw('min_quantity'));

      if (error) throw error;
      console.log(`✅ Priority stock check: ${items?.length || 0} items below minimum`);
      return res.status(200).json({ message: 'Stock check complete', lowStockItems: items?.length || 0 });
    }

    const { data: items, error } = await supabase
      .from('inventory_items')
      .select('id, name, sku, quantity, min_quantity')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .eq('is_priority', true);

    if (error) throw error;

    const lowStock = (items || []).filter(i => i.quantity < (i.min_quantity || 10));
    console.log(`✅ Priority stock check for org ${orgId}: ${lowStock.length} items below minimum`);

    res.status(200).json({ message: 'Stock check complete', lowStockItems: lowStock.length, items: lowStock });
  } catch (error) {
    console.error('Error checking priority stock:', error);
    res.status(500).json({ error: 'Failed to check priority stock.' });
  }
});

module.exports = router;
