const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const fcmService = require('../services/fcmService');
const { verifyFirebaseToken } = require('../middleware/auth');

/**
 * POST /api/stock-take/start-session
 * Notify APKs when a stock take session starts
 */
router.post('/start-session', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, sessionId, startedBy, startedByEmail } = req.body;

        if (!orgId || !sessionId || !startedBy) {
            return res.status(400).json({
                error: 'Missing required fields: orgId, sessionId, startedBy'
            });
        }

        console.log(`📋 Starting stock take session notification for org: ${orgId}`);

        // Send FCM notification to all APKs in the organization
        const result = await fcmService.sendNotificationToOrganization(
            orgId,
            '📋 Stock Take Started',
            `Stock take session started by ${startedBy}. Tap to join!`,
            {
                type: 'STOCK_TAKE_START',
                sessionId: sessionId,
                startedBy: startedBy,
                startedByEmail: startedByEmail || '',
                organizationId: orgId,
                timestamp: Date.now().toString()
            }
        );

        console.log(`✅ Stock take start notification sent to ${result.sentCount} devices`);

        res.json({
            success: true,
            sessionId: sessionId,
            notificationResult: result
        });

    } catch (error) {
        console.error('❌ Error sending stock take start notification:', error);
        res.status(500).json({
            error: 'Failed to send stock take start notification',
            details: error.message
        });
    }
});

/**
 * POST /api/stock-take/end-session
 * Notify APKs when a stock take session ends
 */
router.post('/end-session', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, sessionId, endedBy, summary } = req.body;

        if (!orgId || !sessionId || !endedBy) {
            return res.status(400).json({
                error: 'Missing required fields: orgId, sessionId, endedBy'
            });
        }

        console.log(`📋 Ending stock take session notification for org: ${orgId}`);

        // Send FCM notification to all APKs in the organization
        const result = await fcmService.sendNotificationToOrganization(
            orgId,
            '📋 Stock Take Completed',
            `Stock take session ended by ${endedBy}. ${summary?.totalItemsScanned || 0} items scanned.`,
            {
                type: 'STOCK_TAKE_END',
                sessionId: sessionId,
                endedBy: endedBy,
                summary: summary || {},
                organizationId: orgId,
                timestamp: Date.now().toString()
            }
        );

        console.log(`✅ Stock take end notification sent to ${result.sentCount} devices`);

        res.json({
            success: true,
            sessionId: sessionId,
            notificationResult: result
        });

    } catch (error) {
        console.error('❌ Error sending stock take end notification:', error);
        res.status(500).json({
            error: 'Failed to send stock take end notification',
            details: error.message
        });
    }
});

/**
 * POST /api/stock-take/scan-item
 * Record a scanned item during stock take session
 */
router.post('/scan-item', verifyFirebaseToken, async (req, res) => {
    try {
        const { 
            orgId, 
            sessionId, 
            itemId, 
            scannedQuantity, 
            expectedQuantity, 
            scannedBy, 
            deviceId 
        } = req.body;

        if (!orgId || !sessionId || !itemId || scannedQuantity === undefined) {
            return res.status(400).json({
                error: 'Missing required fields: orgId, sessionId, itemId, scannedQuantity'
            });
        }

        console.log(`📋 Recording stock take scan for item ${itemId} in session ${sessionId}`);

        // Get item details from inventory
        const itemDoc = await admin.firestore()
            .collection('organizations')
            .doc(orgId)
            .collection('inventory')
            .doc(itemId)
            .get();

        if (!itemDoc.exists) {
            return res.status(404).json({
                error: 'Item not found in inventory'
            });
        }

        const itemData = itemDoc.data();
        const itemName = itemData.name || itemData.itemName || 'Unknown Item';
        const sku = itemData.sku || 'Unknown SKU';

        // ── Baseline snapshot lookup ───────────────────────────────────────────
        // Always use the quantity frozen at session-open time, NOT the current live
        // stock value.  Stock movements that happen during the count (sales, receipts)
        // must NOT silently change the expected value — that would corrupt the variance
        // and the audit trail.  Client-supplied expectedQuantity is ignored.
        let frozenExpectedQty = itemData.stock ?? itemData.quantity ?? 0;
        try {
            const sessionFirestoreRef = admin.firestore()
                .collection('organizations').doc(orgId)
                .collection('stockTakeSessions').doc(sessionId);
            const sessionSnap = await sessionFirestoreRef.get();
            if (sessionSnap.exists) {
                const baseline = sessionSnap.data()?.baselineSnapshot;
                if (baseline && typeof baseline[itemId] === 'number') {
                    frozenExpectedQty = baseline[itemId];
                }
            }
        } catch (baselineErr) {
            // Non-fatal: fall back to live stock value and log — do NOT block the scan
            console.warn(`⚠️ Baseline read failed for item ${itemId}, using live stock value:`, baselineErr.message);
        }

    // Update stock take session in Realtime Database.
    // Canonical path (used by Dashboard): organizations/{orgId}/stockTakeSessions/{sessionId}
    // Legacy path (used by current APK build): stockTakeSessions/{orgId}/{sessionId}
    // We write to BOTH to keep Dashboard and APK in sync.
    const orgItemPath = `organizations/${orgId}/stockTakeSessions/${sessionId}/scannedItems/${itemId}`;
    const orgItemRef = admin.database().ref(orgItemPath);
    const legacyItemPath = `stockTakeSessions/${orgId}/${sessionId}/scannedItems/${itemId}`;
    const legacyItemRef = admin.database().ref(legacyItemPath);

        const newRecord = {
            itemId: itemId,
            itemName: itemName,
            sku: sku,
            scannedQuantity: parseInt(scannedQuantity),
            expectedQuantity: frozenExpectedQty,   // always from baseline, never live
            scannedBy: scannedBy || 'Unknown User',
            scannedAt: Date.now(),
            deviceId: deviceId || 'unknown_device'
        };

        // Transaction on canonical (organizations/...) path: write only if there's no existing record (first-writer-wins)
        const txResult = await orgItemRef.transaction(current => {
            if (current === null) {
                return newRecord; // proceed to write
            }
            return; // abort - keep existing
        });

        // txResult: { committed, snapshot }
        const committed = txResult && txResult.committed;
        const finalSnapshot = txResult && txResult.snapshot;

        if (!committed) {
            // Someone else already scanned this item; return existing record so
            // the APK can show an "Already scanned" message without overwriting.
            const existing = finalSnapshot ? finalSnapshot.val() : null;
            console.log(`⚠️ Item ${itemId} already scanned in session ${sessionId}`);

            return res.status(200).json({
                success: true,
                alreadyScanned: true,
                existing
            });
        }

        // Mirror to legacy path for current APK builds
        try {
            await legacyItemRef.set(newRecord);
        } catch (mirrorErr) {
            console.warn('⚠️ Failed to mirror scanned item to legacy path:', mirrorErr.message);
        }

        // Update session metadata on both paths (best-effort)
        try {
            const orgSessionRef = admin.database().ref(`organizations/${orgId}/stockTakeSessions/${sessionId}`);
            const legacySessionRef = admin.database().ref(`stockTakeSessions/${orgId}/${sessionId}`);

            const hasIncrement = admin?.database?.ServerValue && typeof admin.database.ServerValue.increment === 'function';
            const incrementValue = hasIncrement ? admin.database.ServerValue.increment(1) : null;

            const ops = [
                orgSessionRef.child('lastActivity').set(Date.now()),
                legacySessionRef.child('lastActivity').set(Date.now())
            ];
            if (incrementValue) {
                ops.push(orgSessionRef.child('totalItemsScanned').set(incrementValue));
                ops.push(legacySessionRef.child('totalItemsScanned').set(incrementValue));
            }

            await Promise.allSettled(ops);
        } catch (metaErr) {
            console.warn('⚠️ Failed to update session metadata:', metaErr.message);
        }

        // Create activity log entry for stock take scan
        await admin.firestore()
            .collection('organizations')
            .doc(orgId)
            .collection('activityLogs')
            .add({
                user: scannedBy || 'Unknown User',
                action: 'stock_take_scan',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                details: {
                    sessionId: sessionId,
                    itemName: itemName,
                    sku: sku,
                    scannedQuantity: parseInt(scannedQuantity),
                    expectedQuantity: frozenExpectedQty,
                    variance: parseInt(scannedQuantity) - frozenExpectedQty,
                    deviceId: deviceId || 'unknown_device'
                }
            });

        console.log(`✅ Stock take scan recorded for ${itemName}`);

        res.json({
            success: true,
            sessionId: sessionId,
            itemId: itemId,
            itemName: itemName,
            scannedQuantity: parseInt(scannedQuantity),
            expectedQuantity: frozenExpectedQty
        });

    } catch (error) {
        console.error('❌ Error recording stock take scan:', error);
        res.status(500).json({
            error: 'Failed to record stock take scan',
            details: error.message
        });
    }
});

module.exports = router;