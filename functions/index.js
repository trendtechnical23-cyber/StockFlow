const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK (if not already initialized)
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * DISABLED: Firebase Cloud Function for Activity Log Notifications
 * 
 * This function was causing DUPLICATE notifications because it runs
 * in parallel with the Express server notification system.
 * 
 * The Express server (firestoreListenerService.js) now handles all
 * notifications, so these Cloud Functions are disabled to prevent
 * duplicate notifications.
 * 
 * IMPORTANT: DO NOT RE-ENABLE without removing Express notifications
 */
// DISABLED: Causing duplicate notifications - Express server handles this now
/*
exports.sendActivityNotification = functions.firestore
  .document('orgs/{orgId}/activityLogs/{logId}')
  .onWrite(async (change, context) => {
    try {
      const orgId = context.params.orgId;
      const logId = context.params.logId;
      
      console.log(`🔔 Activity log notification triggered for org: ${orgId}, log: ${logId}`);
      
      // Check if this is a delete operation
      if (!change.after.exists) {
        console.log(`📝 Activity log ${logId} was deleted, skipping notification`);
        return null;
      }
      
      const activityData = change.after.data();
      
      // Skip if this is just a metadata update without actual activity
      if (!activityData || !activityData.action) {
        console.log(`⚠️ Invalid activity data structure, skipping notification`);
        return null;
      }
      
      // Determine notification content based on activity type
      let title = '📦 Inventory Update';
      let body = `${activityData.action} activity logged`;
      
      if (activityData.itemName) {
        switch (activityData.action?.toLowerCase()) {
          case 'stock_update':
            title = '📊 Stock Updated';
            body = `${activityData.itemName}: ${activityData.details || 'Stock quantity changed'}`;
            break;
          case 'item_added':
            title = '➕ New Item Added';
            body = `${activityData.itemName} has been added to inventory`;
            break;
          case 'item_deleted':
            title = '🗑️ Item Removed';
            body = `${activityData.itemName} has been removed from inventory`;
            break;
          case 'low_stock_alert':
            title = '⚠️ Low Stock Alert';
            body = `${activityData.itemName} is running low on stock`;
            break;
          case 'stock_take':
          case 'stocktake':
            title = '📋 Stock Take';
            body = `Stock take completed for ${activityData.itemName}`;
            break;
          case 'stock_take_begin':
          case 'stocktake_begin':
          case 'stock_take_started':
          case 'stocktake_started':
            title = '📋 Stock Take Started';
            body = `Stock take begun for ${activityData.itemName}`;
            break;
          case 'stock_take_completed':
          case 'stocktake_completed':
          case 'stock_take_finished':
          case 'stocktake_finished':
            title = '✅ Stock Take Completed';
            body = `Stock take completed for ${activityData.itemName}`;
            break;
          default:
            body = `${activityData.itemName}: ${activityData.action}`;
        }
      }
      
      // Prepare the notification message
      const message = {
        topic: `org_${orgId}`,
        notification: {
          title: title,
          body: body
        },
        data: {
          type: 'activity_log',
          orgId: orgId,
          logId: logId,
          action: activityData.action || 'unknown',
          timestamp: new Date().toISOString(),
          itemId: activityData.itemId || '',
          itemName: activityData.itemName || ''
        },
        android: {
          notification: {
            icon: 'ic_notification',
            color: '#2196F3',
            sound: 'default',
            channelId: 'inventory_updates'
          },
          priority: 'high'
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        },
        webpush: {
          notification: {
            icon: '/icon-192x192.png',
            badge: '/badge-72x72.png',
            requireInteraction: false,
            renotify: true,
            tag: `activity_${orgId}_${logId}`
          }
        }
      };
      
      console.log(`📤 Sending notification to topic: org_${orgId}`);
      console.log(`📋 Message content: ${title} - ${body}`);
      
      // Send the notification
      const response = await admin.messaging().send(message);
      
      console.log(`✅ Notification sent successfully: ${response}`);
      
      return {
        success: true,
        messageId: response,
        orgId: orgId,
        logId: logId,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error sending activity notification:`, error);
      
      // Log additional context for debugging
      console.error(`🔍 Context - orgId: ${context.params.orgId}, logId: ${context.params.logId}`);
      console.error(`🔍 Change exists - before: ${change.before.exists}, after: ${change.after.exists}`);
      
      // Don't throw the error to prevent function retries
      // Cloud Functions will retry on thrown errors, which we don't want
      return {
        success: false,
        error: error.message,
        orgId: context.params.orgId,
        logId: context.params.logId,
        timestamp: new Date().toISOString()
      };
    }
  });
*/

/**
 * OPTIONAL: Health check function for monitoring
 * This helps verify that Cloud Functions are properly deployed
 */
exports.healthCheck = functions.https.onRequest((req, res) => {
  console.log('🏥 Health check requested');
  
  res.status(200).json({
    status: 'healthy',
    service: 'inventory-cloud-functions',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

/**
 * OPTIONAL: Manual notification trigger (for testing)
 * Call this function to test the notification system
 * 
 * Usage: POST to the function URL with:
 * {
 *   "orgId": "your_org_id",
 *   "title": "Test Notification",
 *   "body": "This is a test message"
 * }
 */
exports.testNotification = functions.https.onRequest(async (req, res) => {
  try {
    console.log('🧪 Test notification requested');
    
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }
    
    const { orgId, title = 'Test Notification', body = 'This is a test message' } = req.body;
    
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    
    const message = {
      topic: `org_${orgId}`,
      notification: {
        title: title,
        body: body
      },
      data: {
        type: 'test',
        orgId: orgId,
        timestamp: new Date().toISOString()
      }
    };
    
    const response = await admin.messaging().send(message);
    
    console.log(`✅ Test notification sent: ${response}`);
    
    res.status(200).json({
      success: true,
      messageId: response,
      orgId: orgId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error sending test notification:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});