const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/auth');
const { supabase } = require('../supabaseAdmin');

/**
 * POST /api/stock-take/start-session
 * Record that a stock take session started + log activity
 */
router.post('/start-session', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, sessionId, startedBy, startedByEmail } = req.body;

        if (!orgId || !sessionId || !startedBy) {
            return res.status(400).json({ error: 'Missing required fields: orgId, sessionId, startedBy' });
        }

        console.log(`📋 Stock take session started for org: ${orgId}, session: ${sessionId}`);

        await supabase.from('activity_logs').insert({
            org_id: orgId,
            type: 'stock_take_start',
            entity_type: 'session',
            entity_id: sessionId,
            actor_id: req.user.uid,
            details: { started_by: startedBy, started_by_email: startedByEmail || req.user.email },
        });

        res.json({ success: true, sessionId, message: 'Stock take session started' });
    } catch (error) {
        console.error('❌ Error starting stock take session:', error);
        res.status(500).json({ error: 'Failed to start stock take session', details: error.message });
    }
});

/**
 * POST /api/stock-take/end-session
 * Record that a stock take session ended
 */
router.post('/end-session', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, sessionId, endedBy, summary } = req.body;

        if (!orgId || !sessionId || !endedBy) {
            return res.status(400).json({ error: 'Missing required fields: orgId, sessionId, endedBy' });
        }

        console.log(`📋 Stock take session ended for org: ${orgId}, session: ${sessionId}`);

        // Update session status in Supabase
        await supabase
            .from('stock_take_sessions')
            .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: req.user.uid })
            .eq('id', sessionId)
            .eq('org_id', orgId);

        await supabase.from('activity_logs').insert({
            org_id: orgId,
            type: 'stock_take_end',
            entity_type: 'session',
            entity_id: sessionId,
            actor_id: req.user.uid,
            details: { ended_by: endedBy, summary: summary || {} },
        });

        res.json({ success: true, sessionId, message: 'Stock take session ended' });
    } catch (error) {
        console.error('❌ Error ending stock take session:', error);
        res.status(500).json({ error: 'Failed to end stock take session', details: error.message });
    }
});

/**
 * POST /api/stock-take/scan-item
 * Record a scanned item during stock take
 */
router.post('/scan-item', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, sessionId, itemId, scannedQuantity, expectedQuantity, scannedBy, deviceId } = req.body;

        if (!orgId || !sessionId || !itemId || scannedQuantity === undefined) {
            return res.status(400).json({ error: 'Missing required fields: orgId, sessionId, itemId, scannedQuantity' });
        }

        console.log(`📋 Recording stock take scan for item ${itemId} in session ${sessionId}`);

        // Get item details from inventory_items
        const { data: itemData, error: itemError } = await supabase
            .from('inventory_items')
            .select('id, name, sku, quantity')
            .eq('id', itemId)
            .eq('org_id', orgId)
            .maybeSingle();

        if (itemError || !itemData) {
            return res.status(404).json({ error: 'Item not found in inventory' });
        }

        // Determine frozen expected quantity from session baseline
        let frozenExpectedQty = itemData.quantity ?? 0;
        const { data: sessionData } = await supabase
            .from('stock_take_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('org_id', orgId)
            .maybeSingle();

        // Check if item was already scanned in this session
        const { data: existingEntry } = await supabase
            .from('stock_take_entries')
            .select('id, counted_quantity')
            .eq('session_id', sessionId)
            .eq('item_id', itemId)
            .maybeSingle();

        if (existingEntry) {
            console.log(`⚠️ Item ${itemId} already scanned in session ${sessionId}`);
            return res.status(200).json({
                success: true,
                alreadyScanned: true,
                existing: existingEntry,
            });
        }

        // Insert scan entry
        const { error: insertError } = await supabase.from('stock_take_entries').insert({
            session_id: sessionId,
            org_id: orgId,
            item_id: itemId,
            sku: itemData.sku || null,
            counted_quantity: parseInt(scannedQuantity),
            expected_quantity: frozenExpectedQty,
            scanned_by: req.user.uid,
            scanned_at: new Date().toISOString(),
        });

        if (insertError) throw insertError;

        // Log activity
        await supabase.from('activity_logs').insert({
            org_id: orgId,
            type: 'stock_take_scan',
            entity_type: 'inventory',
            entity_id: itemId,
            actor_id: req.user.uid,
            details: {
                session_id: sessionId,
                item_name: itemData.name,
                sku: itemData.sku || null,
                scanned_quantity: parseInt(scannedQuantity),
                expected_quantity: frozenExpectedQty,
                variance: parseInt(scannedQuantity) - frozenExpectedQty,
                device_id: deviceId || 'unknown_device',
            },
        });

        console.log(`✅ Stock take scan recorded for ${itemData.name}`);

        res.json({
            success: true,
            sessionId,
            itemId,
            itemName: itemData.name,
            scannedQuantity: parseInt(scannedQuantity),
            expectedQuantity: frozenExpectedQty,
        });
    } catch (error) {
        console.error('❌ Error recording stock take scan:', error);
        res.status(500).json({ error: 'Failed to record stock take scan', details: error.message });
    }
});

module.exports = router;
