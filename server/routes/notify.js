const express = require('express');
const { sendNotificationToUser, sendNotificationToOrg, sendStockActivityNotification } = require('../sendNotification');
const { verifyFirebaseToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/notify/test
 * Test FCM notification sending to a specific user
 */
router.post('/test', verifyFirebaseToken, async (req, res) => {
  try {
    const { targetUid, title, body, data } = req.body;
    
    // Use current user if no target specified
    const userUid = targetUid || req.user.uid;
    
    console.log(`🧪 Testing FCM notification to user: ${userUid}`);
    
    const result = await sendNotificationToUser(
      userUid,
      title || "Test Notification",
      body || "This is a test notification from StockFlow backend",
      data || { type: "TEST", sender: req.user.email }
    );

    res.json({
      success: result.success,
      message: result.success ? "Test notification sent successfully" : "Failed to send test notification",
      details: result
    });

  } catch (error) {
    console.error('❌ Test notification error:', error);
    res.status(500).json({
      success: false,
      message: "Test notification failed",
      error: error.message
    });
  }
});

/**
 * POST /api/notify/org-test
 * Test FCM notification sending to an entire organization
 */
router.post('/org-test', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, title, body, data } = req.body;
    
    if (!orgId) {
      return res.status(400).json({
        success: false,
        message: "orgId is required"
      });
    }
    
    console.log(`🧪 Testing FCM notification to organization: ${orgId}`);
    
    const result = await sendNotificationToOrg(
      orgId,
      title || "Organization Test Notification",
      body || "This is a test notification to all organization members",
      data || { type: "ORG_TEST", sender: req.user.email }
    );

    res.json({
      success: result.success,
      message: result.success ? "Organization test notification sent successfully" : "Failed to send organization test notification",
      details: result
    });

  } catch (error) {
    console.error('❌ Organization test notification error:', error);
    res.status(500).json({
      success: false,
      message: "Organization test notification failed",
      error: error.message
    });
  }
});

/**
 * POST /api/notify/stock-test
 * Test stock activity notification
 */
router.post('/stock-test', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, itemName, qtyChange, action } = req.body;
    
    if (!orgId || !itemName || qtyChange === undefined || !action) {
      return res.status(400).json({
        success: false,
        message: "orgId, itemName, qtyChange, and action are required"
      });
    }
    
    console.log(`🧪 Testing stock activity notification for org: ${orgId}`);
    
    const result = await sendStockActivityNotification(
      orgId,
      itemName,
      parseInt(qtyChange),
      req.user.email,
      action
    );

    res.json({
      success: result.success,
      message: result.success ? "Stock activity test notification sent successfully" : "Failed to send stock activity test notification",
      details: result
    });

  } catch (error) {
    console.error('❌ Stock activity test notification error:', error);
    res.status(500).json({
      success: false,
      message: "Stock activity test notification failed",
      error: error.message
    });
  }
});

module.exports = router;