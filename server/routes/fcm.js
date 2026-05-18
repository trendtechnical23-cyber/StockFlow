/**
 * FCM (Firebase Cloud Messaging) Routes
 * Handles push notification API endpoints
 */

const express = require('express');
const router = express.Router();
const fcmService = require('../services/fcmService');
const firestoreListenerService = require('../services/firestoreListenerService');
const admin = require('firebase-admin');
const { verifyFirebaseToken } = require('../middleware/auth');

/**
 * Test notification endpoint
 * POST /api/fcm/test-notify/:userId
 * Send a test notification to a specific user
 */
router.post('/test-notify/:userId', verifyFirebaseToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { orgId, title, body, data } = req.body;

        // Validate required parameters
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'User ID is required in URL path'
            });
        }

        if (!orgId) {
            return res.status(400).json({
                success: false,
                error: 'Organization ID is required in request body'
            });
        }

        // Use default values if not provided
        const notificationTitle = title || 'Test Notification';
        const notificationBody = body || `Hello! This is a test notification sent at ${new Date().toLocaleString()}`;
        const notificationData = {
            type: 'system',
            test: 'true',
            ...data
        };

        console.log(`🧪 Test notification requested for user ${userId} in org ${orgId}`);

        // Send test notification
        const result = await fcmService.sendNotificationToUser(
            userId,
            notificationTitle,
            notificationBody,
            notificationData,
            orgId
        );

        if (result.success) {
            res.json({
                success: true,
                message: `Test notification sent successfully to user ${userId}`,
                result: {
                    userId: result.userId,
                    messageId: result.messageId,
                    fcmToken: result.fcmToken
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: `Failed to send test notification to user ${userId}`,
                error: result.error,
                reason: result.reason
            });
        }

    } catch (error) {
        console.error('❌ Test notification error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Send notification to user
 * POST /api/fcm/send-to-user
 * Send a notification to a specific user
 */
router.post('/send-to-user', verifyFirebaseToken, async (req, res) => {
    try {
        const { userId, orgId, title, body, data } = req.body;

        // Validate required parameters
        if (!userId || !orgId || !title || !body) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, orgId, title, body'
            });
        }

        console.log(`📤 Notification request for user ${userId} in org ${orgId}: ${title}`);

        const result = await fcmService.sendNotificationToUser(
            userId,
            title,
            body,
            data || {},
            orgId
        );

        if (result.success) {
            res.json({
                success: true,
                message: `Notification sent successfully to user ${userId}`,
                result: {
                    userId: result.userId,
                    messageId: result.messageId,
                    fcmToken: result.fcmToken
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: `Failed to send notification to user ${userId}`,
                error: result.error,
                reason: result.reason
            });
        }

    } catch (error) {
        console.error('❌ Send notification error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Send notification to organization
 * POST /api/fcm/send-to-organization
 * Send a notification to all users in an organization
 */
router.post('/send-to-organization', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, title, body, data } = req.body;

        // Validate required parameters
        if (!orgId || !title || !body) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: orgId, title, body'
            });
        }

        console.log(`📢 Organization notification request for org ${orgId}: ${title}`);

        const result = await fcmService.sendNotificationToOrganization(
            orgId,
            title,
            body,
            data || {}
        );

        res.json({
            success: result.success,
            message: result.success 
                ? `Notification sent to ${result.sentCount}/${result.totalUsers} users in organization ${orgId}`
                : `Failed to send notification to organization ${orgId}`,
            result: {
                totalUsers: result.totalUsers,
                sentCount: result.sentCount,
                failedCount: result.failedCount,
                details: result.results
            }
        });

    } catch (error) {
        console.error('❌ Organization notification error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Send notification to topic
 * POST /api/fcm/send-to-topic
 * Send a notification using FCM topics (organization-wide)
 */
router.post('/send-to-topic', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, title, body, data } = req.body;

        // Validate required parameters
        if (!orgId || !title || !body) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: orgId, title, body'
            });
        }

        console.log(`📢 Topic notification request for org ${orgId}: ${title}`);

        const result = await fcmService.sendNotificationToTopic(
            orgId,
            title,
            body,
            data || {}
        );

        if (result.success) {
            res.json({
                success: true,
                message: `Topic notification sent successfully to organization ${orgId}`,
                result: {
                    messageId: result.messageId,
                    topic: result.topic
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: `Failed to send topic notification to organization ${orgId}`,
                error: result.error
            });
        }

    } catch (error) {
        console.error('❌ Topic notification error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Get notification statistics
 * GET /api/fcm/stats/:orgId
 * Get notification statistics for an organization
 */
router.get('/stats/:orgId', async (req, res) => {
    try {
        const { orgId } = req.params;
        const { days } = req.query;

        if (!orgId) {
            return res.status(400).json({
                success: false,
                error: 'Organization ID is required'
            });
        }

        const stats = await fcmService.getNotificationStats(orgId, parseInt(days) || 7);

        if (stats) {
            res.json({
                success: true,
                orgId,
                period: `${parseInt(days) || 7} days`,
                stats
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve notification statistics'
            });
        }

    } catch (error) {
        console.error('❌ Notification stats error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Get FCM listener status
 * GET /api/fcm/listener-status
 * Get the status of Firestore listeners
 */
router.get('/listener-status', (req, res) => {
    try {
        const status = firestoreListenerService.getStatus();
        
        res.json({
            success: true,
            status
        });

    } catch (error) {
        console.error('❌ Listener status error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Start Firestore listeners
 * POST /api/fcm/start-listeners
 * Manually start the Firestore listeners
 */
router.post('/start-listeners', (req, res) => {
    try {
        firestoreListenerService.startListeners();
        
        res.json({
            success: true,
            message: 'Firestore listeners started successfully',
            status: firestoreListenerService.getStatus()
        });

    } catch (error) {
        console.error('❌ Start listeners error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Stop Firestore listeners
 * POST /api/fcm/stop-listeners
 * Manually stop the Firestore listeners
 */
router.post('/stop-listeners', (req, res) => {
    try {
        firestoreListenerService.stopListeners();
        
        res.json({
            success: true,
            message: 'Firestore listeners stopped successfully',
            status: firestoreListenerService.getStatus()
        });

    } catch (error) {
        console.error('❌ Stop listeners error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

/**
 * Comprehensive test route with examples
 * GET /api/fcm/test-examples
 * Returns examples of how to use the FCM endpoints
 */
router.get('/test-examples', (req, res) => {
    const examples = {
        testNotification: {
            method: 'POST',
            endpoint: '/api/fcm/test-notify/{userId}',
            body: {
                orgId: 'your-org-id',
                title: 'Test Notification (optional)',
                body: 'Custom test message (optional)',
                data: {
                    type: 'system',
                    custom_field: 'custom_value'
                }
            },
            example: 'POST /api/fcm/test-notify/user123'
        },
        sendToUser: {
            method: 'POST',
            endpoint: '/api/fcm/send-to-user',
            body: {
                userId: 'user123',
                orgId: 'org456',
                title: 'Low Stock Alert',
                body: 'Product A is running low (5 units remaining)',
                data: {
                    type: 'stock_low',
                    item_name: 'Product A',
                    stock_level: '5'
                }
            }
        },
        sendToOrganization: {
            method: 'POST',
            endpoint: '/api/fcm/send-to-organization',
            body: {
                orgId: 'org456',
                title: 'System Maintenance',
                body: 'Scheduled maintenance tonight at 2 AM',
                data: {
                    type: 'system',
                    priority: 'normal'
                }
            }
        },
        getStats: {
            method: 'GET',
            endpoint: '/api/fcm/stats/{orgId}?days=7',
            example: '/api/fcm/stats/org456?days=30'
        }
    };

    res.json({
        success: true,
        message: 'FCM API endpoints and usage examples',
        baseUrl: req.protocol + '://' + req.get('host'),
        examples
    });
});

/**
 * Debug: List FCM tokens for an organization
 * GET /api/fcm/tokens/:orgId
 */
router.get('/tokens/:orgId', async (req, res) => {
    try {
        const { orgId } = req.params;
        if (!orgId) {
            return res.status(400).json({ success: false, error: 'Organization ID is required' });
        }

        const db = admin.firestore();
        const usersSnap = await db
            .collection('organizations')
            .doc(orgId)
            .collection('users')
            .where('fcmToken', '!=', null)
            .get();

        const tokens = usersSnap.docs.map(d => ({ userId: d.id, email: d.data().email || null, fcmToken: d.data().fcmToken }));

        res.json({ success: true, orgId, count: tokens.length, tokens });
    } catch (error) {
        console.error('❌ Error listing FCM tokens:', error.message);
        res.status(500).json({ success: false, error: 'Internal server error', details: error.message });
    }
});

module.exports = router;