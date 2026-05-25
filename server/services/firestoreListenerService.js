/**
 * Firestore Listeners Service
 * Monitors activity logs and automatically sends notifications
 */

const admin = require('firebase-admin');
const fcmService = require('./fcmService');

class FirestoreListenerService {
    constructor() {
        this._db = null;
        this.listeners = new Map(); // Store active listeners
        this.isListening = false;
        this.serverStartTime = Date.now(); // Track when server started to avoid old notifications
        this.processedActivities = new Set(); // Track processed activities to prevent duplicates
        console.log('🕒 Firestore Listener Service initialized - Start time:', new Date(this.serverStartTime).toISOString());
    }

    get db() {
        if (!this._db) this._db = admin.firestore();
        return this._db;
    }

    /**
     * Start all Firestore listeners
     */
    /**
     * Start Firestore listeners.
     * By default this starts only the global `activities` listener to avoid
     * opening listeners for every organization at startup (which can exhaust
     * Firestore quotas). Pass startAll=true to restore legacy behavior.
     */
    startListeners(startAll = false) {
        if (this.isListening) {
            console.log('🔄 Firestore listeners already active');
            return;
        }

        console.log('🎧 Starting Firestore listeners for automatic notifications...');

        // Always start the activities collection listener (used for mirroring)
        this.startActivitiesListener();

        if (startAll) {
            // Legacy: start listeners for all organizations (dangerous at scale)
            this.startActivityLogListener();
            this.startAuditLogListener();
            this.startInventoryListener();
            this.startLowStockListener();
            console.log('✅ All Firestore listeners started (legacy mode)');
        } else {
            console.log('✅ Firestore listeners started in lazy mode (activities only). Use addOrganizationListeners(orgId) to enable per-org listeners.');
        }

        this.isListening = true;
    }

    /**
     * Stop all listeners
     */
    stopListeners() {
        console.log('🛑 Stopping Firestore listeners...');
        
        this.listeners.forEach((unsubscribe, name) => {
            unsubscribe();
            console.log(`   Stopped ${name} listener`);
        });
        
        this.listeners.clear();
        this.isListening = false;
        console.log('✅ All Firestore listeners stopped');
    }

    /**
     * Listen to activities collection for real-time mirroring between Dashboard and APK
     */
    startActivitiesListener() {
        console.log('🔥 Starting activities collection listener...');

        // Only listen to activities created AFTER the server started.
        // Without this filter the initial snapshot loads the entire collection
        // into memory which causes an OOM kill on Railway's container.
        const listenFrom = admin.firestore.Timestamp.fromMillis(this.serverStartTime);

        const unsubscribe = this.db
            .collection('activities')
            .where('timestamp', '>=', listenFrom)
            .onSnapshot(async (snapshot) => {
                try {
                for (const change of snapshot.docChanges()) {
                    if (change.type === 'added') {
                        const data = change.doc.data();
                        
                        // Check if this activity happened after server startup
                        const activityTime = data.timestamp?.seconds ? data.timestamp.seconds * 1000 : new Date(data.timestamp).getTime();
                        if (activityTime < this.serverStartTime) {
                            console.log(`⏳ Skipping old real-time activity from before server start: ${data.action}`);
                            continue;
                        }
                        
                        // Create unique activity ID to prevent duplicate processing
                        const activityId = `realtime_${data.orgId}_${data.action}_${data.userId}_${activityTime}_${data.itemName || 'noitem'}`;
                        if (this.processedActivities.has(activityId)) {
                            console.log(`🔄 Skipping duplicate real-time activity: ${data.action}`);
                            continue;
                        }
                        
                        // Mark as processed
                        this.processedActivities.add(activityId);
                        
                        console.log(`📱 Real-time activity from ${data.source}: ${data.action}`);
                        
                        // Notify both directions while avoiding self-notifications by channel
                        if (data.orgId) {
                            // If APK originated, notify org users (dashboard users/devices)
                            if (data.source === 'apk') {
                                // Sanitize all data fields to ensure they are strings (FCM requirement)
                                const sanitizeForFCM = (value) => {
                                    if (value === null || value === undefined) return '';
                                    if (typeof value === 'object') {
                                        return typeof value.toISOString === 'function' ? value.toISOString() : JSON.stringify(value);
                                    }
                                    return String(value);
                                };

                                const notification = {
                                title: 'Mobile Activity',
                                body: `📱 ${sanitizeForFCM(data.action)}${data.itemName ? ` - ${sanitizeForFCM(data.itemName)}` : ''}`,
                                data: {
                                    type: 'activity_mirror',
                                    source: sanitizeForFCM(data.source),
                                    activityId: sanitizeForFCM(change.doc.id),
                                    orgId: sanitizeForFCM(data.orgId),
                                    userId: sanitizeForFCM(data.userId),
                                    userName: sanitizeForFCM(data.userName || data.userEmail || data.user || ''),
                                    action: sanitizeForFCM(data.action),
                                    itemId: sanitizeForFCM(data.itemId),
                                    itemName: sanitizeForFCM(data.itemName),
                                    quantity: sanitizeForFCM(data.quantity),
                                    timestamp: sanitizeForFCM(data.timestamp)
                                }
                                };
                                const result = await fcmService.sendNotificationToOrganization(
                                    data.orgId,
                                    notification.title,
                                    notification.body,
                                    notification.data
                                );
                                // Fallback to topic ONLY if zero users were found (not if sends failed)
                                if (!result || result.totalUsers === 0) {
                                    await fcmService.sendNotificationToTopic(
                                        data.orgId,
                                        notification.title,
                                        notification.body,
                                        notification.data
                                    );
                                }
                            }

                            // If Dashboard originated, notify APK devices via topic (APK subscribes to org topics)
                            if (data.source === 'dashboard') {
                                // Sanitize all data fields to ensure they are strings (FCM requirement)
                                const sanitizeForFCM = (value) => {
                                    if (value === null || value === undefined) return '';
                                    if (typeof value === 'object') {
                                        return typeof value.toISOString === 'function' ? value.toISOString() : JSON.stringify(value);
                                    }
                                    return String(value);
                                };

                                const notification = {
                                    title: 'Dashboard Activity',
                                    body: `🖥️ ${sanitizeForFCM(data.action)}${data.itemName ? ` - ${sanitizeForFCM(data.itemName)}` : ''}`,
                                    data: {
                                        type: 'activity_mirror',
                                        source: sanitizeForFCM(data.source),
                                        activityId: sanitizeForFCM(change.doc.id),
                                        orgId: sanitizeForFCM(data.orgId),
                                        userId: sanitizeForFCM(data.userId),
                                        userName: sanitizeForFCM(data.userName || data.userEmail || data.user || ''),
                                        action: sanitizeForFCM(data.action),
                                        itemId: sanitizeForFCM(data.itemId),
                                        itemName: sanitizeForFCM(data.itemName),
                                        quantity: sanitizeForFCM(data.quantity),
                                        timestamp: sanitizeForFCM(data.timestamp)
                                    }
                                };

                                await fcmService.sendNotificationToTopic(
                                    data.orgId,
                                    notification.title,
                                    notification.body,
                                    notification.data
                                );
                            }
                        }
                    }
                }
                } catch (err) {
                    console.error('⚠️ Activities listener callback error (non-fatal):', err.message);
                }
            }, (error) => {
                console.error('❌ Activities listener error:', error.message);
            });

        this.listeners.set('activities', unsubscribe);
        console.log('✅ Activities listener started');
    }

    /**
     * Listen to activity logs for stock operations.
     * NOTE: FCM notifications are ONLY sent from startActivitiesListener() (the
     * global `activities` collection) to prevent duplicate notifications.  This
     * listener is kept for local logging / analytics but does NOT send FCM.
     */
    startActivityLogListener() {
        const makeListener = (rootCollection) => (orgId) => {
            const unsubscribe = this.db
                .collection(rootCollection)
                .doc(orgId)
                .collection('activityLogs')
                .orderBy('timestamp', 'desc')
                .limit(1)
                .onSnapshot(async (snapshot) => {
                    try {
                    for (const change of snapshot.docChanges()) {
                        if (change.type === 'added') {
                            // Log only — do NOT send FCM here (avoids duplicate notifications)
                            const data = change.doc.data();
                            const activityTime = data.timestamp?.seconds ? data.timestamp.seconds * 1000 : new Date(data.timestamp).getTime();
                            if (activityTime >= this.serverStartTime) {
                                console.log(`📋 Org activity log (no FCM): ${data.action} for org ${orgId}`);
                            }
                        }
                    }
                    } catch (err) { console.error(`⚠️ Activity log callback error (non-fatal):`, err.message); }
                }, (error) => {
                    console.error(`❌ Activity log listener error for org ${orgId} (${rootCollection}):`, error.message);
                });

            return unsubscribe;
        };

        // Listen only to the canonical organizations collection to prevent duplicates
        this.listenToAllOrganizations('activityLogs', makeListener('organizations'), 'organizations');
    }

    /**
     * Listen to audit logs for system changes
     */
    startAuditLogListener() {
        const makeListener = (rootCollection) => (orgId) => {
            const unsubscribe = this.db
                .collection(rootCollection)
                .doc(orgId)
                .collection('auditLogs')
                .orderBy('timestamp', 'desc')
                .limit(1)
                .onSnapshot(async (snapshot) => {
                    try {
                    for (const change of snapshot.docChanges()) {
                        if (change.type === 'added') {
                            await this.handleAuditLog(change.doc.data(), orgId);
                        }
                    }
                    } catch (err) { console.error(`⚠️ Audit log callback error (non-fatal):`, err.message); }
                }, (error) => {
                    console.error(`❌ Audit log listener error for org ${orgId} (${rootCollection}):`, error.message);
                });

            return unsubscribe;
        };

        this.listenToAllOrganizations('auditLogs', makeListener('organizations'), 'organizations');
    }

    /**
     * Listen to inventory collection for stock changes
     */
    startInventoryListener() {
        const makeListener = (rootCollection) => (orgId) => {
            const unsubscribe = this.db
                .collection(rootCollection)
                .doc(orgId)
                .collection('inventory')
                .onSnapshot(async (snapshot) => {
                    try {
                    for (const change of snapshot.docChanges()) {
                        if (change.type === 'modified') {
                            await this.handleInventoryChange(change.doc.data(), change.doc.id, orgId, change.oldIndex, change.newIndex);
                        }
                    }
                    } catch (err) { console.error(`⚠️ Inventory listener callback error (non-fatal):`, err.message); }
                }, (error) => {
                    console.error(`❌ Inventory listener error for org ${orgId} (${rootCollection}):`, error.message);
                });

            return unsubscribe;
        };

        this.listenToAllOrganizations('inventory', makeListener('organizations'), 'organizations');
    }

    /**
     * Listen for low stock conditions
     */
    startLowStockListener() {
        const makeListener = (rootCollection) => (orgId) => {
            const unsubscribe = this.db
                .collection(rootCollection)
                .doc(orgId)
                .collection('inventory')
                .where('quantity', '<=', 10) // Configurable threshold
                .onSnapshot(async (snapshot) => {
                    try {
                    for (const change of snapshot.docChanges()) {
                        if (change.type === 'added' || change.type === 'modified') {
                            await this.handleLowStockAlert(change.doc.data(), change.doc.id, orgId);
                        }
                    }
                    } catch (err) { console.error(`⚠️ Low stock listener callback error (non-fatal):`, err.message); }
                }, (error) => {
                    console.error(`❌ Low stock listener error for org ${orgId} (${rootCollection}):`, error.message);
                });

            return unsubscribe;
        };

        this.listenToAllOrganizations('lowStock', makeListener('organizations'), 'organizations');
    }

    /**
     * Set up listeners for all organizations
     */
    async listenToAllOrganizations(listenerName, createListener, rootCollection = 'organizations') {
        try {
            // Get all organizations from specified root collection
            const orgsSnapshot = await this.db.collection(rootCollection).get();
            
            orgsSnapshot.docs.forEach((orgDoc) => {
                const orgId = orgDoc.id;
                const unsubscribe = createListener(orgId);
                this.listeners.set(`${listenerName}_${rootCollection}_${orgId}`, unsubscribe);
            });

            console.log(`✅ ${listenerName} listeners set up for ${orgsSnapshot.docs.length} organizations under '${rootCollection}'`);

        } catch (error) {
            console.error(`❌ Failed to set up ${listenerName} listeners:`, error.message);
        }
    }

    /**
     * Handle new activity log entries
     */
    async handleActivityLog(activityData, orgId) {
        try {
            const { action, user, timestamp, details } = activityData;
            
            // Extract item details - check both root level and details object
            const itemName = activityData.itemName || details?.itemName;
            const quantity = activityData.quantity || details?.scannedQuantity || details?.quantity;
            
            // Check if this activity happened after server startup to avoid old notifications
            const activityTime = timestamp?.seconds ? timestamp.seconds * 1000 : new Date(timestamp).getTime();
            if (activityTime < this.serverStartTime) {
                console.log(`⏳ Skipping old activity from before server start: ${action} (${new Date(activityTime).toISOString()})`);
                return;
            }
            
            // Create unique activity ID to prevent duplicate processing
            const activityId = `${orgId}_${action}_${user}_${activityTime}_${itemName || 'noitem'}`;
            if (this.processedActivities.has(activityId)) {
                console.log(`🔄 Skipping duplicate activity: ${action} for ${itemName || 'item'} (already processed)`);
                return;
            }
            
            // Mark as processed
            this.processedActivities.add(activityId);
            
            // Clean up old processed activities (keep only last 5000 to prevent memory bloat)
            if (this.processedActivities.size > 5000) {
                const oldestEntries = Array.from(this.processedActivities).slice(0, 2500);
                oldestEntries.forEach(id => this.processedActivities.delete(id));
                console.log('🧹 Cleaned up old processed activity IDs');
            }
            
            console.log(`📋 New activity log for org ${orgId}:`, activityData.action);
            
            let title, body, notificationType;

            switch (action) {
                case 'stock_in':
                case 'add_stock':
                    title = '📦 Stock Added';
                    body = `${user || 'Someone'} added ${quantity || 'items'} of ${itemName || 'unknown item'} to inventory`;
                    notificationType = 'stock_in';
                    break;

                case 'stock_out':
                case 'remove_stock':
                    title = '📤 Stock Removed';
                    body = `${user || 'Someone'} removed ${quantity || 'items'} of ${itemName || 'unknown item'} from inventory`;
                    notificationType = 'activity';
                    break;

                case 'stock_take_scan':
                    title = '📱 Stock Take Scan';
                    body = `${user || 'Someone'} scanned ${itemName || 'item'} (Qty: ${quantity || 'unknown'})`;
                    notificationType = 'stock_take';
                    break;

                case 'stock_take':
                case 'inventory_count':
                    title = '📋 Stock Take Completed';
                    body = `${user || 'Someone'} completed a stock take for ${itemName || 'inventory'}`;
                    notificationType = 'activity';
                    break;

                case 'stock_adjustment':
                    title = '⚖️ Stock Adjusted';
                    body = `${user || 'Someone'} adjusted stock for ${itemName || 'unknown item'}`;
                    notificationType = 'activity';
                    break;

                default:
                    title = '📊 Inventory Activity';
                    body = `${user || 'Someone'} performed ${action} on ${itemName || 'inventory'}`;
                    notificationType = 'activity';
            }

            // Send notification to organization - sanitize all data for FCM
            const sanitizeForFCM = (value) => {
                if (value === null || value === undefined) return '';
                if (typeof value === 'object') {
                    return typeof value.toISOString === 'function' ? value.toISOString() : JSON.stringify(value);
                }
                return String(value);
            };

            const result = await fcmService.sendNotificationToOrganization(
                orgId,
                title,
                body,
                {
                    type: sanitizeForFCM(notificationType),
                    action: sanitizeForFCM(action),
                    item_name: sanitizeForFCM(itemName),
                    quantity: sanitizeForFCM(quantity),
                    user: sanitizeForFCM(user),
                    timestamp: sanitizeForFCM(timestamp || new Date().toISOString())
                }
            );

            console.log(`📤 Activity notification result: ${result.success ? 'Success' : 'Failed'} (${result.sentCount}/${result.totalUsers})`);

        } catch (error) {
            console.error('❌ Error handling activity log:', error.message);
        }
    }

    /**
     * Handle audit log entries
     */
    async handleAuditLog(auditData, orgId) {
        try {
            console.log(`🔍 New audit log for org ${orgId}:`, auditData.action);

            const { action, user, details, timestamp } = auditData;
            
            // Only notify for important audit events
            const importantActions = [
                'user_added',
                'user_removed',
                'settings_changed',
                'data_export',
                'data_import',
                'system_backup'
            ];

            if (!importantActions.includes(action)) {
                return; // Skip non-important audit events
            }

            let title, body;

            switch (action) {
                case 'user_added':
                    title = '👤 User Added';
                    body = `${user || 'Admin'} added a new user to the organization`;
                    break;

                case 'user_removed':
                    title = '🚪 User Removed';
                    body = `${user || 'Admin'} removed a user from the organization`;
                    break;

                case 'settings_changed':
                    title = '⚙️ Settings Updated';
                    body = `${user || 'Admin'} updated organization settings`;
                    break;

                case 'data_export':
                    title = '📤 Data Exported';
                    body = `${user || 'Admin'} exported organization data`;
                    break;

                case 'data_import':
                    title = '📥 Data Imported';
                    body = `${user || 'Admin'} imported data to the system`;
                    break;

                default:
                    title = '🔍 System Activity';
                    body = `${user || 'System'} performed ${action}`;
            }

            // Send notification to organization
            await fcmService.sendNotificationToOrganization(
                orgId,
                title,
                body,
                {
                    type: 'system',
                    action: action,
                    user: user,
                    details: details,
                    timestamp: timestamp || new Date().toISOString()
                }
            );

        } catch (error) {
            console.error('❌ Error handling audit log:', error.message);
        }
    }

    /**
     * Handle inventory changes
     */
    async handleInventoryChange(inventoryData, itemId, orgId, oldIndex, newIndex) {
        try {
            const { name, quantity, threshold } = inventoryData;
            
            // Check if quantity actually changed (not just metadata updates)
            if (oldIndex === newIndex) return;

            console.log(`📊 Inventory change for org ${orgId}, item ${name}: quantity=${quantity}`);

            // Check for stock out condition
            if (quantity <= 0) {
                await fcmService.sendNotificationToOrganization(
                    orgId,
                    '🚨 Out of Stock Alert',
                    `${name} is now out of stock!`,
                    {
                        type: 'stock_out',
                        item_name: name,
                        item_id: itemId,
                        stock_level: quantity?.toString(),
                        priority: 'high'
                    }
                );
            }
            // Check for low stock condition
            else if (threshold && quantity <= threshold) {
                await fcmService.sendNotificationToOrganization(
                    orgId,
                    '⚠️ Low Stock Alert',
                    `${name} is running low (${quantity} remaining, threshold: ${threshold})`,
                    {
                        type: 'stock_low',
                        item_name: name,
                        item_id: itemId,
                        stock_level: quantity?.toString(),
                        threshold: threshold?.toString(),
                        priority: 'normal'
                    }
                );
            }

        } catch (error) {
            console.error('❌ Error handling inventory change:', error.message);
        }
    }

    /**
     * Handle low stock alerts
     */
    async handleLowStockAlert(inventoryData, itemId, orgId) {
        try {
            const { name, quantity, threshold, lastAlertSent } = inventoryData;

            // Avoid spam - only send alert once per hour per item
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            let lastAlertDate = null;
            if (lastAlertSent) {
                if (typeof lastAlertSent.toDate === 'function') {
                    lastAlertDate = lastAlertSent.toDate();
                } else if (typeof lastAlertSent === 'string' || typeof lastAlertSent === 'number') {
                    const d = new Date(lastAlertSent);
                    if (!isNaN(d.getTime())) lastAlertDate = d;
                }
            }
            if (lastAlertDate && lastAlertDate > oneHourAgo) {
                return; // Throttle
            }

            console.log(`⚠️ Low stock alert for org ${orgId}, item ${name}: ${quantity} remaining`);

            if (quantity <= 0) {
                await fcmService.sendNotificationToOrganization(
                    orgId,
                    '🚨 URGENT: Out of Stock',
                    `${name} is completely out of stock!`,
                    {
                        type: 'stock_out',
                        item_name: name,
                        item_id: itemId,
                        stock_level: '0',
                        priority: 'high',
                        urgent: 'true'
                    }
                );
            } else {
                const result = await fcmService.sendNotificationToOrganization(
                    orgId,
                    '⚠️ Low Stock Warning',
                    `${name} is running low - only ${quantity} units remaining`,
                    {
                        type: 'stock_low',
                        item_name: name,
                        item_id: itemId,
                        stock_level: quantity?.toString(),
                        threshold: threshold?.toString(),
                        priority: 'normal'
                    }
                );
                if (!result || result.sentCount === 0) {
                    // Avoid spamming console endlessly
                    console.debug(`ℹ️ Low stock: no FCM tokens for org ${orgId} (suppressed)`);
                }
            }

            // Update last alert timestamp to prevent spam
            await this.db
                .collection('organizations')
                .doc(orgId)
                .collection('inventory')
                .doc(itemId)
                .update({
                    lastAlertSent: admin.firestore.FieldValue.serverTimestamp()
                });

        } catch (error) {
            console.error('❌ Error handling low stock alert:', error.message);
        }
    }

    /**
     * Add a new organization to listeners
     */
    async addOrganizationListeners(orgId) {
        console.log(`➕ Adding listeners for new organization: ${orgId}`);
        
        // Add activity log listener
        const activityUnsubscribe = this.db
            .collection('organizations')
            .doc(orgId)
            .collection('activityLogs')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .onSnapshot(async (snapshot) => {
                for (const change of snapshot.docChanges()) {
                    if (change.type === 'added') {
                        await this.handleActivityLog(change.doc.data(), orgId);
                    }
                }
            });

        // Add audit log listener
        const auditUnsubscribe = this.db
            .collection('organizations')
            .doc(orgId)
            .collection('auditLogs')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .onSnapshot(async (snapshot) => {
                for (const change of snapshot.docChanges()) {
                    if (change.type === 'added') {
                        await this.handleAuditLog(change.doc.data(), orgId);
                    }
                }
            });

        // Add inventory listener
        const inventoryUnsubscribe = this.db
            .collection('organizations')
            .doc(orgId)
            .collection('inventory')
            .onSnapshot(async (snapshot) => {
                for (const change of snapshot.docChanges()) {
                    if (change.type === 'modified') {
                        await this.handleInventoryChange(change.doc.data(), change.doc.id, orgId, change.oldIndex, change.newIndex);
                    }
                }
            });

        // Store listeners
        this.listeners.set(`activityLogs_${orgId}`, activityUnsubscribe);
        this.listeners.set(`auditLogs_${orgId}`, auditUnsubscribe);
        this.listeners.set(`inventory_${orgId}`, inventoryUnsubscribe);
        
        console.log(`✅ Listeners added for organization ${orgId}`);
    }

    /**
     * Remove listeners for an organization
     */
    removeOrganizationListeners(orgId) {
        console.log(`➖ Removing listeners for organization: ${orgId}`);
        
        const listenersToRemove = [
            `activityLogs_${orgId}`,
            `auditLogs_${orgId}`,
            `inventory_${orgId}`,
            `lowStock_${orgId}`
        ];

        listenersToRemove.forEach(listenerKey => {
            const unsubscribe = this.listeners.get(listenerKey);
            if (unsubscribe) {
                unsubscribe();
                this.listeners.delete(listenerKey);
                console.log(`   Removed ${listenerKey} listener`);
            }
        });
        
        console.log(`✅ Listeners removed for organization ${orgId}`);
    }

    /**
     * Get listener status
     */
    getStatus() {
        return {
            isListening: this.isListening,
            activeListeners: this.listeners.size,
            listenerNames: Array.from(this.listeners.keys())
        };
    }
}

module.exports = new FirestoreListenerService();