/**
 * Firebase Cloud Messaging (FCM) Service
 * Handles push notifications to StockFlow Android APK
 * Uses Firebase Admin SDK HTTP v1 API
 */

const admin = require('firebase-admin');

class FCMService {
    constructor() {
        this._db = null;
        this._messaging = null;
    }

    get db() { if (!this._db) this._db = admin.firestore(); return this._db; }
    get messaging() { if (!this._messaging) this._messaging = admin.messaging(); return this._messaging; }

    /**
     * Send notification to a specific user by userId
     * @param {string} userId - The user ID 
     * @param {string} title - Notification title
     * @param {string} body - Notification body
     * @param {Object} data - Additional data payload
     * @param {string} orgId - Organization ID
     * @returns {Promise<Object>} Success or failure result
     */
    async sendNotificationToUser(userId, title, body, data = {}, orgId) {
        try {
            console.log(`📤 Sending notification to user ${userId}: ${title}`);
            
            if (!userId || !title || !body || !orgId) {
                throw new Error('Missing required parameters: userId, title, body, or orgId');
            }

            // Fetch user's FCM token from Firestore
            const userDoc = await this.db
                .collection('organizations')
                .doc(orgId)
                .collection('users')
                .doc(userId)
                .get();

            if (!userDoc.exists) {
                console.warn(`⚠️ User ${userId} not found in organization ${orgId}`);
                return { 
                    success: false, 
                    error: `User ${userId} not found in organization ${orgId}`,
                    userId 
                };
            }

            const userData = userDoc.data();
            const fcmToken = userData.fcmToken;

            if (!fcmToken) {
                console.warn(`⚠️ No FCM token found for user ${userId}`);
                return { 
                    success: false, 
                    error: `No FCM token found for user ${userId}`,
                    userId 
                };
            }

            // Check notification settings
            const notificationSettings = userData.notificationSettings || {};
            if (!this.shouldSendNotification(data.type, notificationSettings)) {
                console.log(`🔇 Notification blocked by user settings for ${userId}, type: ${data.type}`);
                return { 
                    success: false, 
                    error: `Notification blocked by user settings`,
                    userId,
                    reason: 'user_settings'
                };
            }

            // Prepare FCM message
            const message = {
                token: fcmToken,
                notification: {
                    title: title,
                    body: body
                },
                data: {
                    ...data,
                    timestamp: new Date().toISOString(),
                    userId: userId,
                    orgId: orgId
                },
                android: {
                    notification: {
                        icon: 'ic_notification',
                        color: '#6A1B9A',
                        sound: 'default',
                        channelId: 'stockflow_notifications',
                        visibility: data.type === 'STOCK_TAKE_START' ? 'public' : 'private'
                    },
                    priority: this.getAndroidPriority(data.type)
                }
            };

            // Send notification using HTTP v1 API
            const response = await this.messaging.send(message);
            
            console.log(`✅ Notification sent successfully to ${userId}:`, response);
            
            // Log notification to Firestore for tracking
            await this.logNotification({
                userId,
                orgId,
                title,
                body,
                data,
                fcmResponse: response,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'sent'
            });

            return { 
                success: true, 
                messageId: response, 
                userId,
                fcmToken: fcmToken.substring(0, 20) + '...' // Masked token for security
            };

        } catch (error) {
            console.error(`❌ Failed to send notification to user ${userId}:`, error.message);
            
            // Log failed notification
            await this.logNotification({
                userId,
                orgId,
                title,
                body,
                data,
                error: error.message,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'failed'
            });

            return { 
                success: false, 
                error: error.message, 
                userId 
            };
        }
    }

    /**
     * Send notification to all users in an organization
     * @param {string} orgId - Organization ID
     * @param {string} title - Notification title
     * @param {string} body - Notification body
     * @param {Object} data - Additional data payload
     * @returns {Promise<Object>} Results summary
     */
    async sendNotificationToOrganization(orgId, title, body, data = {}) {
        try {
            console.log(`📢 Sending notification to all users in organization ${orgId}: ${title}`);
            
            if (!orgId || !title || !body) {
                throw new Error('Missing required parameters: orgId, title, or body');
            }

            // Get all users in the organization with FCM tokens
            const usersSnapshot = await this.db
                .collection('organizations')
                .doc(orgId)
                .collection('users')
                .where('fcmToken', '!=', null)
                .get();

            if (usersSnapshot.empty) {
                console.warn(`⚠️ No users with FCM tokens found in organization ${orgId}`);
                return {
                    success: true,
                    totalUsers: 0,
                    sentCount: 0,
                    failedCount: 0,
                    results: []
                };
            }

            const users = usersSnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            console.log(`📱 Found ${users.length} users with FCM tokens in organization ${orgId}`);

            // Send notifications concurrently with optimized batching
            const isCritical = data.type === 'STOCK_TAKE_START' || data.type === 'STOCK_TAKE_END';
            const batchSize = isCritical ? 10 : 5; // Larger batches for critical notifications
            const batchDelay = isCritical ? 50 : 100; // Shorter delays for critical notifications
            
            const results = [];
            
            for (let i = 0; i < users.length; i += batchSize) {
                const batch = users.slice(i, i + batchSize);
                const batchPromises = batch.map(user => 
                    this.sendNotificationToUser(user.id, title, body, data, orgId)
                );
                
                const batchResults = await Promise.allSettled(batchPromises);
                results.push(...batchResults.map(result => 
                    result.status === 'fulfilled' ? result.value : { 
                        success: false, 
                        error: result.reason?.message || 'Unknown error' 
                    }
                ));
                
                // Reduced delay between batches for critical notifications
                if (i + batchSize < users.length) {
                    await new Promise(resolve => setTimeout(resolve, batchDelay));
                }
            }

            const sentCount = results.filter(r => r.success).length;
            const failedCount = results.filter(r => !r.success).length;

            console.log(`✅ Notification sending complete for organization ${orgId}:`);
            console.log(`   📤 Sent: ${sentCount}/${users.length}`);
            console.log(`   ❌ Failed: ${failedCount}/${users.length}`);

            return {
                success: true,
                totalUsers: users.length,
                sentCount,
                failedCount,
                results
            };

        } catch (error) {
            console.error(`❌ Failed to send notification to organization ${orgId}:`, error.message);
            return {
                success: false,
                error: error.message,
                totalUsers: 0,
                sentCount: 0,
                failedCount: 0
            };
        }
    }

    /**
     * Send notification using topic (organization-wide)
     * @param {string} orgId - Organization ID
     * @param {string} title - Notification title
     * @param {string} body - Notification body
     * @param {Object} data - Additional data payload
     * @returns {Promise<Object>} Result
     */
    async sendNotificationToTopic(orgId, title, body, data = {}) {
        try {
            const topic = `org_${orgId}`;
            
            console.log(`📢 Sending topic notification to ${topic}: ${title}`);

            const message = {
                topic: topic,
                notification: {
                    title: title,
                    body: body
                },
                data: {
                    ...data,
                    timestamp: new Date().toISOString(),
                    orgId: orgId
                },
                android: {
                    notification: {
                        icon: 'ic_notification',
                        color: '#6A1B9A',
                        sound: 'default',
                        channelId: 'stockflow_notifications'
                    },
                    priority: this.getAndroidPriority(data.type)
                }
            };

            const response = await this.messaging.send(message);
            
            console.log(`✅ Topic notification sent successfully:`, response);
            
            return { 
                success: true, 
                messageId: response,
                topic
            };

        } catch (error) {
            console.error(`❌ Failed to send topic notification:`, error.message);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    /**
     * Check if notification should be sent based on user settings
     * @param {string} notificationType - Type of notification
     * @param {Object} userSettings - User notification settings
     * @returns {boolean} Whether to send notification
     */
    shouldSendNotification(notificationType, userSettings) {
        // Default to enabled unless explicitly disabled
        if (!userSettings) return true;

        // Respect a master toggle only if it's explicitly set to false
        if (userSettings.allNotifications === false) return false;

        switch (notificationType) {
            case 'stock_low':
                return userSettings.stockLowAlerts !== false;
            case 'stock_out':
                return userSettings.stockOutAlerts !== false;
            case 'stock_in':
                return userSettings.stockInNotifications !== false;
            case 'activity':
            case 'activity_mirror':
                return userSettings.activityUpdates !== false;
            case 'system':
                return userSettings.systemNotifications !== false;
            default:
                return true; // Send by default for unknown types
        }
    }

    /**
     * Get Android notification priority based on type
     * @param {string} notificationType - Type of notification
     * @returns {string} Android priority level
     */
    getAndroidPriority(notificationType) {
        switch (notificationType) {
            case 'STOCK_TAKE_START':
            case 'STOCK_TAKE_END':
                return 'high'; // Critical stock take notifications
            case 'stock_out':
            case 'stock_low':
                return 'high';
            case 'STOCK_IN':
            case 'STOCK_OUT':
            case 'stock_in':
            case 'activity':
                return 'normal';
            case 'INVENTORY_UPDATE':
            case 'STOCK_TAKE_SCAN':
            case 'system':
                return 'normal';
            default:
                return 'normal';
        }
    }

    /**
     * Log notification to Firestore for tracking and analytics
     * @param {Object} notificationData - Notification data to log
     */
    async logNotification(notificationData) {
        try {
            await this.db
                .collection('organizations')
                .doc(notificationData.orgId)
                .collection('notifications')
                .add(notificationData);
                
        } catch (error) {
            console.error('Failed to log notification:', error.message);
            // Don't throw error for logging failures
        }
    }

    /**
     * Get notification statistics for an organization
     * @param {string} orgId - Organization ID
     * @param {number} days - Number of days to look back (default: 7)
     * @returns {Promise<Object>} Notification statistics
     */
    async getNotificationStats(orgId, days = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            const notificationsSnapshot = await this.db
                .collection('organizations')
                .doc(orgId)
                .collection('notifications')
                .where('timestamp', '>=', startDate)
                .get();

            const notifications = notificationsSnapshot.docs.map(doc => doc.data());
            
            const stats = {
                totalSent: notifications.filter(n => n.status === 'sent').length,
                totalFailed: notifications.filter(n => n.status === 'failed').length,
                byType: {},
                byDay: {}
            };

            // Group by type
            notifications.forEach(notification => {
                const type = notification.data?.type || 'unknown';
                stats.byType[type] = (stats.byType[type] || 0) + 1;
            });

            return stats;

        } catch (error) {
            console.error('Failed to get notification stats:', error.message);
            return null;
        }
    }
}

module.exports = new FCMService();