const express = require('express');
const admin = require('firebase-admin');
const { verifyFirebaseToken, requireOrg } = require('../middleware/auth');
const notifications = require('../services/notifications');

const router = express.Router();
const db = admin.firestore();
const firestoreListenerService = require('../services/firestoreListenerService');

/**
 * POST /api/devices/register
 * Register device token for push notifications
 */
router.post('/register', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, deviceToken, platform } = req.body;

    // Input validation
    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({
        error: {
          message: 'orgId is required and must be a string',
          status: 400
        }
      });
    }

    if (!deviceToken || typeof deviceToken !== 'string') {
      return res.status(400).json({
        error: {
          message: 'deviceToken is required and must be a string',
          status: 400
        }
      });
    }

    if (!platform || typeof platform !== 'string') {
      return res.status(400).json({
        error: {
          message: 'platform is required and must be a string',
          status: 400
        }
      });
    }

    // Organization access check
    if (req.user.orgId !== orgId) {
      console.warn(`❌ Access denied: User ${req.user.email} (org: ${req.user.orgId}) attempted to register device for org: ${orgId}`);
      return res.status(403).json({
        error: {
          message: 'Access denied: You can only register devices for your own organization',
          status: 403
        }
      });
    }

    // Save device token to Firestore
    const tokenDocRef = db.collection('organizations').doc(orgId).collection('deviceTokens').doc(deviceToken);
    
    await tokenDocRef.set({
      token: deviceToken,
      platform: platform,
      uid: req.user.uid,
      userEmail: req.user.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });

    // Subscribe token to organization topic
    try {
      await notifications.subscribeTokenToOrgTopic(deviceToken, orgId);
    } catch (subscriptionError) {
      console.warn(`⚠️ Device registered but topic subscription failed for org ${orgId}:`, subscriptionError.message);
      // Don't fail the entire request for subscription issues
    }

    console.log(`✅ Device registered: ${platform} token for user ${req.user.email} in org ${orgId}`);

    // Start per-organization listeners lazily when a device registers for that org.
    try {
      // This will attach activity/audit/inventory listeners for this org only.
      await firestoreListenerService.addOrganizationListeners(orgId);
    } catch (listenerErr) {
      console.warn(`⚠️ Could not start per-org listeners for ${orgId}:`, listenerErr.message);
    }

    res.json({
      success: true,
      message: 'Device registered successfully',
      data: {
        orgId: orgId,
        platform: platform,
        userEmail: req.user.email,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error registering device:', error.message);
    
    res.status(500).json({
      error: {
        message: 'Failed to register device',
        status: 500
      }
    });
  }
});

/**
 * POST /api/devices/unregister
 * Unregister device token from push notifications
 */
router.post('/unregister', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, deviceToken } = req.body;

    // Input validation
    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({
        error: {
          message: 'orgId is required and must be a string',
          status: 400
        }
      });
    }

    if (!deviceToken || typeof deviceToken !== 'string') {
      return res.status(400).json({
        error: {
          message: 'deviceToken is required and must be a string',
          status: 400
        }
      });
    }

    // Organization access check
    if (req.user.orgId !== orgId) {
      console.warn(`❌ Access denied: User ${req.user.email} (org: ${req.user.orgId}) attempted to unregister device for org: ${orgId}`);
      return res.status(403).json({
        error: {
          message: 'Access denied: You can only unregister devices from your own organization',
          status: 403
        }
      });
    }

    // Check if token exists and belongs to the user
    const tokenDocRef = db.collection('organizations').doc(orgId).collection('deviceTokens').doc(deviceToken);
    const tokenDoc = await tokenDocRef.get();

    if (!tokenDoc.exists) {
      return res.status(404).json({
        error: {
          message: 'Device token not found',
          status: 404
        }
      });
    }

    const tokenData = tokenDoc.data();
    if (tokenData.uid !== req.user.uid) {
      console.warn(`❌ Access denied: User ${req.user.email} attempted to unregister token belonging to another user`);
      return res.status(403).json({
        error: {
          message: 'Access denied: You can only unregister your own devices',
          status: 403
        }
      });
    }

    // Unsubscribe from organization topic
    try {
      await notifications.unsubscribeTokenFromOrgTopic(deviceToken, orgId);
    } catch (unsubscriptionError) {
      console.warn(`⚠️ Topic unsubscription failed for org ${orgId}:`, unsubscriptionError.message);
      // Continue with token removal even if unsubscription fails
    }

    // Remove token document
    await tokenDocRef.delete();

    console.log(`✅ Device unregistered: ${tokenData.platform} token for user ${req.user.email} in org ${orgId}`);

    res.json({
      success: true,
      message: 'Device unregistered successfully',
      data: {
        orgId: orgId,
        platform: tokenData.platform,
        userEmail: req.user.email,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error unregistering device:', error.message);
    
    res.status(500).json({
      error: {
        message: 'Failed to unregister device',
        status: 500
      }
    });
  }
});

module.exports = router;