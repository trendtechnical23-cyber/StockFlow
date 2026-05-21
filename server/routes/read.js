const express = require('express');
const admin = require('firebase-admin');
const { verifyFirebaseToken, requireOrg } = require('../middleware/auth');

const router = express.Router();
const getDb = () => admin.firestore();

/**
 * GET /api/inventory/:orgId
 * Get paginated inventory list for organization
 */
router.get('/inventory/:orgId', verifyFirebaseToken, requireOrg('orgId'), async (req, res) => {
  try {
    const { orgId } = req.params;
    const { limit = 50, startAfter, orderBy = 'name', order = 'asc' } = req.query;

    // Validate limit
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: {
          message: 'limit must be a number between 1 and 100',
          status: 400
        }
      });
    }

    // Validate orderBy field
    const allowedOrderFields = ['name', 'quantity', 'lastUpdated', 'createdAt'];
    if (!allowedOrderFields.includes(orderBy)) {
      return res.status(400).json({
        error: {
          message: `orderBy must be one of: ${allowedOrderFields.join(', ')}`,
          status: 400
        }
      });
    }

    // Validate order direction
    if (!['asc', 'desc'].includes(order)) {
      return res.status(400).json({
        error: {
          message: 'order must be "asc" or "desc"',
          status: 400
        }
      });
    }

    let query = getDb().collection('organizations').doc(orgId).collection('inventory')
      .orderBy(orderBy, order)
      .limit(limitNum);

    // Handle pagination with startAfter
    if (startAfter) {
      try {
        const startAfterDoc = await getDb().collection('organizations').doc(orgId).collection('inventory').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      } catch (error) {
        console.warn(`⚠️ Invalid startAfter document: ${startAfter}`, error.message);
      }
    }

    const snapshot = await query.get();
    
    const items = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      items.push({
        id: doc.id,
        ...data,
        // Convert Firestore timestamps to ISO strings
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        lastUpdated: data.lastUpdated?.toDate?.()?.toISOString() || null
      });
    });

    // Get pagination info
    const hasMore = items.length === limitNum;
    const lastItemId = items.length > 0 ? items[items.length - 1].id : null;

    console.log(`✅ Retrieved ${items.length} inventory items for org: ${orgId}`);

    res.json({
      success: true,
      data: {
        items: items,
        pagination: {
          limit: limitNum,
          hasMore: hasMore,
          lastItemId: lastItemId,
          total: items.length
        },
        meta: {
          orgId: orgId,
          orderBy: orderBy,
          order: order,
          timestamp: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error(`❌ Error retrieving inventory for org ${req.params.orgId}:`, error.message);
    
    res.status(500).json({
      error: {
        message: 'Failed to retrieve inventory',
        status: 500
      }
    });
  }
});

/**
 * GET /api/activity/:orgId
 * Get latest activity logs for organization
 */
router.get('/activity/:orgId', verifyFirebaseToken, requireOrg('orgId'), async (req, res) => {
  try {
    const { orgId } = req.params;
    const { limit = 50, startAfter } = req.query;

    // Validate limit
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        error: {
          message: 'limit must be a number between 1 and 100',
          status: 400
        }
      });
    }

    let query = getDb().collection('organizations').doc(orgId).collection('activityLogs')
      .orderBy('timestamp', 'desc')
      .limit(limitNum);

    // Handle pagination with startAfter
    if (startAfter) {
      try {
        const startAfterDoc = await getDb().collection('organizations').doc(orgId).collection('activityLogs').doc(startAfter).get();
        if (startAfterDoc.exists) {
          query = query.startAfter(startAfterDoc);
        }
      } catch (error) {
        console.warn(`⚠️ Invalid startAfter document: ${startAfter}`, error.message);
      }
    }

    const snapshot = await query.get();
    
    const activities = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      activities.push({
        id: doc.id,
        ...data,
        // Convert Firestore timestamps to ISO strings
        timestamp: data.timestamp?.toDate?.()?.toISOString() || null
      });
    });

    // Get pagination info
    const hasMore = activities.length === limitNum;
    const lastActivityId = activities.length > 0 ? activities[activities.length - 1].id : null;

    console.log(`✅ Retrieved ${activities.length} activity logs for org: ${orgId}`);

    res.json({
      success: true,
      data: {
        activities: activities,
        pagination: {
          limit: limitNum,
          hasMore: hasMore,
          lastActivityId: lastActivityId,
          total: activities.length
        },
        meta: {
          orgId: orgId,
          timestamp: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    console.error(`❌ Error retrieving activity logs for org ${req.params.orgId}:`, error.message);
    
    res.status(500).json({
      error: {
        message: 'Failed to retrieve activity logs',
        status: 500
      }
    });
  }
});

module.exports = router;