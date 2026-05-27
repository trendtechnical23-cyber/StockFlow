const express = require('express');
const { verifyFirebaseToken, requireOrg } = require('../middleware/auth');
const { supabase } = require('../supabaseAdmin');

const router = express.Router();

/**
 * GET /api/inventory/:orgId
 * Get paginated inventory list for organization
 */
router.get('/inventory/:orgId', verifyFirebaseToken, requireOrg('orgId'), async (req, res) => {
  try {
    const { orgId } = req.params;
    const { limit = 50, orderBy = 'name', order = 'asc', startAfter } = req.query;

    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: { message: 'limit must be between 1 and 100', status: 400 } });
    }

    const allowedOrderFields = ['name', 'quantity', 'updated_at', 'created_at'];
    if (!allowedOrderFields.includes(orderBy)) {
      return res.status(400).json({ error: { message: `orderBy must be one of: ${allowedOrderFields.join(', ')}`, status: 400 } });
    }

    let query = supabase
      .from('inventory_items')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order(orderBy, { ascending: order === 'asc' })
      .limit(limitNum);

    const { data: items, error } = await query;

    if (error) {
      console.error(`❌ Error reading inventory for org ${orgId}:`, error.message);
      return res.status(500).json({ error: { message: 'Failed to retrieve inventory', status: 500 } });
    }

    console.log(`✅ Retrieved ${items.length} inventory items for org: ${orgId}`);

    res.json({
      success: true,
      data: {
        items,
        pagination: { limit: limitNum, hasMore: items.length === limitNum, total: items.length },
        meta: { orgId, orderBy, order, timestamp: new Date().toISOString() },
      },
    });
  } catch (error) {
    console.error(`❌ Error retrieving inventory for org ${req.params.orgId}:`, error.message);
    res.status(500).json({ error: { message: 'Failed to retrieve inventory', status: 500 } });
  }
});

/**
 * GET /api/activity/:orgId
 * Get latest activity logs for organization
 */
router.get('/activity/:orgId', verifyFirebaseToken, requireOrg('orgId'), async (req, res) => {
  try {
    const { orgId } = req.params;
    const { limit = 50 } = req.query;

    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: { message: 'limit must be between 1 and 100', status: 400 } });
    }

    const { data: activities, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limitNum);

    if (error) {
      console.error(`❌ Error reading activity logs for org ${orgId}:`, error.message);
      return res.status(500).json({ error: { message: 'Failed to retrieve activity logs', status: 500 } });
    }

    console.log(`✅ Retrieved ${activities.length} activity logs for org: ${orgId}`);

    res.json({
      success: true,
      data: {
        activities,
        pagination: { limit: limitNum, hasMore: activities.length === limitNum, total: activities.length },
        meta: { orgId, timestamp: new Date().toISOString() },
      },
    });
  } catch (error) {
    console.error(`❌ Error retrieving activity logs for org ${req.params.orgId}:`, error.message);
    res.status(500).json({ error: { message: 'Failed to retrieve activity logs', status: 500 } });
  }
});

module.exports = router;
