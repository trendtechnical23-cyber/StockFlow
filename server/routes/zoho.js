/**
 * Zoho Books Integration Routes
 * Provides API endpoints for Zoho Books synchronization
 */

const express = require('express');
const router = express.Router();
const zohoService = require('../services/zohoService');
const admin = require('firebase-admin');
const { verifyFirebaseToken } = require('../middleware/auth');

const REGION_ACCOUNTS_DOMAIN = {
    us: 'accounts.zoho.com',
    eu: 'accounts.zoho.eu',
    in: 'accounts.zoho.in',
    au: 'accounts.zoho.com.au',
    jp: 'accounts.zoho.jp',
};

/**
 * POST /api/zoho/config
 * Save per-org Zoho API credentials (Client ID, Secret, Zoho Org ID, Region)
 */
router.post('/config', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId, clientId, clientSecret, zohoOrgId, region, redirectUri } = req.body;

        if (!orgId || !clientId || !clientSecret || !zohoOrgId || !region || !redirectUri) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: orgId, clientId, clientSecret, zohoOrgId, region, redirectUri'
            });
        }

        if (!REGION_ACCOUNTS_DOMAIN[region]) {
            return res.status(400).json({ success: false, message: 'Invalid region value' });
        }

        const db = admin.firestore();
        await db.collection('organizations')
            .doc(orgId)
            .collection('integrations')
            .doc('zoho_config')
            .set({ clientId, clientSecret, zohoOrgId, region, redirectUri, updatedAt: new Date() }, { merge: true });

        console.log('✅ Zoho config saved for org:', orgId);
        res.json({ success: true, message: 'Zoho configuration saved' });
    } catch (error) {
        console.error('❌ Failed to save Zoho config:', error);
        res.status(500).json({ success: false, message: 'Failed to save configuration', error: error.message });
    }
});

/**
 * GET /api/zoho/config
 * Check if per-org Zoho config exists (returns safe, non-secret fields only)
 */
router.get('/config', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId } = req.query;
        if (!orgId) {
            return res.status(400).json({ success: false, message: 'Missing orgId' });
        }

        const db = admin.firestore();
        const doc = await db.collection('organizations').doc(orgId).collection('integrations').doc('zoho_config').get();

        if (!doc.exists) {
            return res.json({ success: true, configured: false });
        }

        const cfg = doc.data();
        res.json({
            success: true,
            configured: true,
            config: {
                clientId: cfg.clientId,
                zohoOrgId: cfg.zohoOrgId,
                region: cfg.region,
                redirectUri: cfg.redirectUri || '',
                // clientSecret intentionally omitted
            }
        });
    } catch (error) {
        console.error('❌ Failed to get Zoho config:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve configuration', error: error.message });
    }
});

/**
 * GET /api/zoho/auth/url
 * Generate Zoho OAuth authorization URL using per-org credentials
 */
router.get('/auth/url', verifyFirebaseToken, async (req, res) => {
    try {
        const { organizationId, userId } = req.query;
        
        if (!organizationId || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: organizationId and userId'
            });
        }

        // Load per-org Zoho config from Firestore
        const db = admin.firestore();
        const configDoc = await db.collection('organizations')
            .doc(organizationId)
            .collection('integrations')
            .doc('zoho_config')
            .get();

        if (!configDoc.exists) {
            return res.status(400).json({
                success: false,
                message: 'Zoho API credentials not configured for this organization. Please configure them in Integrations settings first.'
            });
        }

        const cfg = configDoc.data();
        const clientId = cfg.clientId;
        const accountsDomain = REGION_ACCOUNTS_DOMAIN[cfg.region] || 'accounts.zoho.com';
        const redirectUri = cfg.redirectUri || process.env.ZOHO_REDIRECT_URI;

        if (!clientId) {
            return res.status(400).json({
                success: false,
                message: 'Zoho Client ID is missing. Please reconfigure your Zoho integration.'
            });
        }

        if (!redirectUri) {
            return res.status(400).json({
                success: false,
                message: 'Redirect URI not configured. Please set it in Zoho integration settings.'
            });
        }
        
        // Generate state parameter with organization and user context
        const state = Buffer.from(JSON.stringify({
            organizationId,
            userId,
            timestamp: Date.now()
        })).toString('base64');
        
        const authUrl = `https://${accountsDomain}/oauth/v2/auth?` +
            `response_type=code&` +
            `client_id=${clientId}&` +
            `scope=ZohoBooks.fullaccess.all&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `state=${encodeURIComponent(state)}&` +
            `access_type=offline`;
        
        console.log('🔗 Generated Zoho auth URL for org:', organizationId);
        
        res.json({
            success: true,
            authUrl,
            redirectUri
        });
        
    } catch (error) {
        console.error('❌ Failed to generate auth URL:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate authorization URL',
            error: error.message
        });
    }
});

/**
 * POST /api/zoho/auth/callback
 * Exchange authorization code for tokens
 */
router.post('/auth/callback', verifyFirebaseToken, async (req, res) => {
    try {
        const { code, state } = req.body;
        
        if (!code || !state) {
            return res.status(400).json({
                success: false,
                message: 'Missing authorization code or state parameter'
            });
        }
        
        // Decode and validate state
        let stateData;
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        } catch (e) {
            return res.status(400).json({
                success: false,
                message: 'Invalid state parameter'
            });
        }
        
        // Exchange code for tokens using per-org credentials
        const tokenResponse = await zohoService.exchangeCodeForTokens(code, stateData.organizationId);
        
        if (!tokenResponse.success) {
            console.error('\u274c Token exchange failed for org:', stateData.organizationId, 'Error:', tokenResponse.error);
            return res.status(400).json({
                success: false,
                message: `Failed to exchange authorization code: ${tokenResponse.error || 'Unknown error'}`,
                error: tokenResponse.error
            });
        }
        
        // Store tokens for the organization
        const storeResult = await zohoService.storeTokens(
            stateData.organizationId,
            stateData.userId,
            tokenResponse.tokens
        );
        
        if (!storeResult.success) {
            console.error('❌ Failed to store tokens:', storeResult.error);
            return res.status(500).json({
                success: false,
                message: 'Failed to store authentication tokens',
                error: storeResult.error
            });
        }
        
        console.log('✅ Tokens stored successfully for org:', stateData.organizationId);
        
        res.json({
            success: true,
            message: 'Successfully authenticated with Zoho Books',
            organizationId: stateData.organizationId
        });
        
    } catch (error) {
        console.error('❌ Zoho callback processing failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process authorization callback',
            error: error.message
        });
    }
});

/**
 * GET /api/zoho/test
 * Test connection to Zoho Books
 */
router.get('/test', verifyFirebaseToken, async (req, res) => {
    try {
        console.log('🔍 Testing Zoho Books connection...');
        
        const result = await zohoService.testConnection();
        
        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                data: {
                    organizationId: result.organizationId,
                    organizationName: result.organizationName,
                    timestamp: new Date().toISOString()
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: result.message,
                error: result.error
            });
        }
    } catch (error) {
        console.error('❌ Zoho connection test failed:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during connection test',
            error: error.message
        });
    }
});

/**
 * GET /api/zoho/items?orgId=xxx
 * Get ALL items from Zoho Books for specific organization (auto-paginated)
 */
router.get('/items', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId } = req.query;
        
        if (!orgId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: orgId'
            });
        }
        
        console.log(`📦 Fetching ALL Zoho items for organization: ${orgId}...`);
        
        const result = await zohoService.getItems(orgId);
        
        res.json({
            success: true,
            data: {
                items: result.items,
                pagination: result.page_context,
                count: result.total_items,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to fetch Zoho items:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch items from Zoho Books',
            error: error.response?.data?.message || error.message
        });
    }
});

/**
 * POST /api/zoho/items
 * Create a new item in Zoho Books
 */
router.post('/items', verifyFirebaseToken, async (req, res) => {
    try {
        const itemData = req.body;
        
        if (!itemData.name || !itemData.sku) {
            return res.status(400).json({
                success: false,
                message: 'Item name and SKU are required',
                error: 'Missing required fields'
            });
        }
        
        console.log('📦 Creating item in Zoho Books:', itemData.name);
        
        const zohoItem = await zohoService.createItem(itemData);
        
        res.json({
            success: true,
            message: 'Item created successfully in Zoho Books',
            data: {
                zohoItem: zohoItem,
                itemId: zohoItem.item_id,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to create item in Zoho:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create item in Zoho Books',
            error: error.message
        });
    }
});

/**
 * PUT /api/zoho/items/:itemId
 * Update an existing item in Zoho Books
 */
router.put('/items/:itemId', verifyFirebaseToken, async (req, res) => {
    try {
        const { itemId } = req.params;
        const itemData = req.body;
        
        if (!itemData.name || !itemData.sku) {
            return res.status(400).json({
                success: false,
                message: 'Item name and SKU are required',
                error: 'Missing required fields'
            });
        }
        
        console.log('📦 Updating item in Zoho Books:', itemId);
        
        const zohoItem = await zohoService.updateItem(itemId, itemData);
        
        res.json({
            success: true,
            message: 'Item updated successfully in Zoho Books',
            data: {
                zohoItem: zohoItem,
                itemId: itemId,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to update item in Zoho:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update item in Zoho Books',
            error: error.message
        });
    }
});

/**
 * POST /api/zoho/items/:itemId/adjust-stock
 * Adjust stock quantity for an item in Zoho Books
 */
router.post('/items/:itemId/adjust-stock', verifyFirebaseToken, async (req, res) => {
    try {
        const { itemId } = req.params;
        const { quantity, reason, orgId, referenceNumber } = req.body;

        if (!orgId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: orgId'
            });
        }

        if (typeof quantity !== 'number') {
            return res.status(400).json({
                success: false,
                message: 'Quantity must be a number',
                error: 'Invalid quantity value'
            });
        }

        console.log(`📦 Adjusting stock for item ${itemId} by ${quantity} for org ${orgId}`);

        const adjustment = await zohoService.adjustStock(orgId, itemId, quantity, reason, referenceNumber);

        res.json({
            success: true,
            message: 'Stock adjusted successfully in Zoho Books',
            data: {
                adjustment: adjustment,
                adjustmentId: adjustment?.inventory_adjustment_id,
                itemId: itemId,
                quantityAdjusted: quantity,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to adjust stock in Zoho:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to adjust stock in Zoho Books',
            error: error.message
        });
    }
});

/**
 * POST /api/zoho/approvals/session/process?orgId=xxx
 * Batch-process all approved-but-unprocessed approvals for a stock-take session.
 *
 * Body: { sessionId: string }  — the stockTakeSessionId shared by all approval docs
 *
 * Strategy (per Zoho Books docs):
 *  1. Load all unprocessed approvals for the session in one Firestore read
 *  2. Fetch ALL Zoho items once → build SKU→item_id map (no per-SKU API calls)
 *  3. Create ONE multi-line inventory adjustment covering every item
 *  4. Mark all approval docs processed:true with the same adjustment ID
 *
 * Sending 50+ individual adjustments exhausts daily API limits and clutters the ledger.
 */
router.post('/approvals/session/process', verifyFirebaseToken, async (req, res) => {
    const orgId = req.query.orgId;
    const { sessionId } = req.body;

    if (!orgId) return res.status(400).json({ success: false, message: 'Missing required query parameter: orgId' });
    if (!sessionId) return res.status(400).json({ success: false, message: 'Missing required body field: sessionId' });

    try {
        console.log(`🔄 Batch-processing session ${sessionId} for org ${orgId}…`);

        const db = admin.firestore();

        // 1. Fetch all unprocessed approvals for this session
        const snapshot = await db
            .collection('organizations').doc(orgId)
            .collection('approvals')
            .where('stockTakeSessionId', '==', sessionId)
            .where('status', '==', 'approved')
            .where('processed', '==', false)
            .get();

        if (snapshot.empty) {
            return res.json({ success: true, message: 'No unprocessed approvals found for this session', data: { processed: 0 } });
        }

        const approvals = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`📋 Found ${approvals.length} unprocessed approvals to batch`);

        // 2. Build SKU → Zoho item_id map with a single paginated fetch
        let skuMap;
        try {
            skuMap = await zohoService.buildSkuToItemIdMap(orgId);
        } catch (tokenErr) {
            const msg = tokenErr.message || '';
            if (msg.startsWith('ZOHO_TOKEN_EXPIRED') || msg.includes('not authorized')) {
                return res.status(401).json({
                    success: false,
                    message: 'Zoho access token has expired. Please reconnect Zoho in Integrations.',
                    code: 'ZOHO_TOKEN_EXPIRED'
                });
            }
            throw tokenErr;
        }

        // 3. Build line items — skip any approval whose SKU isn't found in Zoho
        const lineItems = [];
        const skipped = [];

        for (const approval of approvals) {
            const sku = approval.itemSKU;
            const quantityDelta = approval.requestedChange?.quantityDelta;

            if (!sku || typeof quantityDelta !== 'number') {
                skipped.push({ id: approval.id, reason: 'missing SKU or quantityDelta' });
                continue;
            }

            const zohoItemId = skuMap.get(sku);
            if (!zohoItemId) {
                console.warn(`⚠️ SKU '${sku}' not found in Zoho — skipping approval ${approval.id}`);
                skipped.push({ id: approval.id, reason: `SKU '${sku}' not in Zoho Books` });
                // Mark as processed with an error note so it doesn't retry forever
                await db.collection('organizations').doc(orgId)
                    .collection('approvals').doc(approval.id)
                    .update({
                        processed: true,
                        processedAt: admin.firestore.FieldValue.serverTimestamp(),
                        error: `SKU '${sku}' not found in Zoho Books — item may not be synced yet`
                    });
                continue;
            }

            lineItems.push({ item_id: zohoItemId, quantity_adjusted: quantityDelta });
        }

        if (lineItems.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'None of the approvals could be matched to Zoho items. Check that item SKUs are synced to Zoho Books.',
                data: { skipped }
            });
        }

        // 4. Create ONE multi-line inventory adjustment in Zoho Books
        const referenceNumber = `SF-ST-${sessionId.substring(0, 8).toUpperCase()}`;
        const reason = `Stock take adjustment via StockFlow (${lineItems.length} items)`;

        const adj = await zohoService.adjustStockBatch(orgId, lineItems, reason, referenceNumber);
        const adjustmentId = adj?.inventory_adjustment_id || null;

        console.log(`✅ Batch adjustment ${adjustmentId} created — marking ${approvals.length - skipped.length} approvals processed`);

        // 5. Mark all matched approvals as processed in a batch write
        const batch = db.batch();
        const processedAt = admin.firestore.FieldValue.serverTimestamp();

        for (const approval of approvals) {
            const sku = approval.itemSKU;
            if (!sku || !skuMap.get(sku)) continue; // already handled in skipped
            const ref = db.collection('organizations').doc(orgId)
                .collection('approvals').doc(approval.id);
            batch.update(ref, {
                processed: true,
                processedAt,
                zohoResponse: {
                    adjustmentId,
                    status: adj?.status || null,
                    date: adj?.date || null,
                    referenceNumber: adj?.reference_number || referenceNumber
                },
                error: null
            });
        }
        await batch.commit();

        res.json({
            success: true,
            message: `Batch adjustment created in Zoho Books (${lineItems.length} items)`,
            data: {
                sessionId,
                adjustmentId,
                referenceNumber: adj?.reference_number || referenceNumber,
                itemsProcessed: lineItems.length,
                itemsSkipped: skipped.length,
                skipped,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error(`❌ Batch session process failed for session ${sessionId}:`, error);
        const zohoMessage = error.response?.data?.message || error.message;
        res.status(500).json({
            success: false,
            message: `Failed to batch-sync session to Zoho Books: ${zohoMessage}`,
            error: zohoMessage
        });
    }
});

/**
 * POST /api/zoho/sync/pull-quantities?orgId=xxx
 * Pull current stock_on_hand from Zoho Books for a list of SKUs and write
 * those values back to Firestore inventory.
 * This is the ONLY sanctioned way to update local stock when Zoho is connected.
 * Call this AFTER a draft adjustment has been approved inside Zoho Books.
 *
 * Body: { skus: string[] }  — optional, omit to sync ALL items
 */
router.post('/sync/pull-quantities', verifyFirebaseToken, async (req, res) => {
    const orgId = req.query.orgId;
    if (!orgId) return res.status(400).json({ success: false, message: 'Missing orgId' });

    const { skus = [] } = req.body;

    try {
        console.log(`📥 Pulling stock_on_hand from Zoho for org ${orgId} (${skus.length || 'ALL'} items)…`);

        let stockMap;
        try {
            stockMap = await zohoService.fetchStockOnHand(orgId, skus);
        } catch (tokenErr) {
            const msg = tokenErr.message || '';
            if (msg.startsWith('ZOHO_TOKEN_EXPIRED') || msg.includes('not authorized')) {
                return res.status(401).json({
                    success: false,
                    message: 'Zoho access token has expired. Please reconnect Zoho in Integrations.',
                    code: 'ZOHO_TOKEN_EXPIRED'
                });
            }
            throw tokenErr;
        }

        if (stockMap.size === 0) {
            return res.json({ success: true, message: 'No matching items found in Zoho Books', data: { updated: 0 } });
        }

        // Fetch Firestore inventory to find items by SKU
        const db = admin.firestore();
        const invSnap = await db.collection('organizations').doc(orgId)
            .collection('inventory').get();

        const batch = db.batch();
        let updated = 0;
        const changes = [];

        for (const itemDoc of invSnap.docs) {
            const item = itemDoc.data();
            const sku = item.sku || item.SKU;
            if (!sku) continue;

            const zohoData = stockMap.get(sku);
            if (!zohoData) continue;

            const previousStock = item.stock ?? 0;
            const newStock = zohoData.stock_on_hand;

            if (previousStock === newStock) continue; // nothing changed

            batch.update(itemDoc.ref, {
                stock: newStock,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                lastUpdatedBy: {
                    uid: 'zoho-sync',
                    name: 'Zoho Books Sync',
                    email: 'system@zoho-sync'
                },
                zohoLastSync: admin.firestore.FieldValue.serverTimestamp()
            });

            changes.push({ sku, itemName: item.name, previousStock, newStock });
            updated++;
        }

        if (updated > 0) await batch.commit();

        console.log(`✅ Pulled quantities from Zoho: ${updated} items updated`);

        res.json({
            success: true,
            message: `Synced ${updated} item quantities from Zoho Books`,
            data: { updated, changes }
        });

    } catch (error) {
        console.error('❌ pull-quantities failed:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/approvals/:approvalId/process?orgId=xxx
 * Execute an approved stock-adjustment approval in Zoho Books.
 * The frontend calls this AFTER setting status='approved' in Firestore.
 * This endpoint reads the approval, calls Zoho Books, then marks processed=true.
 */
router.post('/approvals/:approvalId/process', verifyFirebaseToken, async (req, res) => {
    const { approvalId } = req.params;
    const orgId = req.query.orgId;

    if (!orgId) {
        return res.status(400).json({ success: false, message: 'Missing required query parameter: orgId' });
    }

    try {
        console.log(`🔄 Processing approval ${approvalId} for org ${orgId}...`);

        const db = admin.firestore();
        const approvalRef = db
            .collection('organizations').doc(orgId)
            .collection('approvals').doc(approvalId);

        const approvalSnap = await approvalRef.get();
        if (!approvalSnap.exists) {
            return res.status(404).json({ success: false, message: 'Approval not found' });
        }

        const approval = approvalSnap.data();

        if (approval.status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: `Approval is not in 'approved' state (current: ${approval.status})`
            });
        }

        if (approval.processed) {
            console.log(`⚠️  Approval ${approvalId} already processed — skipping duplicate call`);
            return res.json({ success: true, message: 'Already processed', data: { alreadyProcessed: true } });
        }

        if (approval.action !== 'adjust_stock') {
            return res.status(400).json({
                success: false,
                message: `Only 'adjust_stock' approvals are supported (got: ${approval.action})`
            });
        }

        const itemSKU = approval.itemSKU;
        if (!itemSKU) {
            return res.status(400).json({ success: false, message: 'Approval is missing itemSKU' });
        }

        // Look up the item in Zoho Books by SKU
        console.log(`🔍 Looking up Zoho item by SKU: ${itemSKU}`);
        let zohoItem;
        try {
            zohoItem = await zohoService.findItemBySku(orgId, itemSKU);
        } catch (lookupError) {
            if (lookupError.message?.startsWith('ZOHO_TOKEN_EXPIRED')) {
                return res.status(401).json({
                    success: false,
                    message: 'Zoho access token has expired. Please go to Integrations and reconnect Zoho Books.',
                    code: 'ZOHO_TOKEN_EXPIRED'
                });
            }
            throw lookupError;
        }

        if (!zohoItem) {
            const errMsg = `Item with SKU '${itemSKU}' not found in Zoho Books`;
            await approvalRef.update({
                processed: true,
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                error: errMsg
            });
            return res.status(404).json({ success: false, message: errMsg });
        }

        const quantityDelta = approval.requestedChange?.quantityDelta;
        if (typeof quantityDelta !== 'number') {
            return res.status(400).json({ success: false, message: 'Approval is missing requestedChange.quantityDelta' });
        }

        const reason = approval.requestedChange?.reason || 'Stock adjustment via StockFlow';
        const referenceNumber = `SF-${approvalId.substring(0, 8).toUpperCase()}`;

        console.log(`📊 Executing Zoho adjustment: item=${zohoItem.item_id} qty=${quantityDelta}`);
        const zohoResponse = await zohoService.adjustStock(
            orgId,
            zohoItem.item_id,
            quantityDelta,
            reason,
            referenceNumber
        );

        // Mark the approval as processed with Zoho response details
        await approvalRef.update({
            processed: true,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            zohoResponse: {
                adjustmentId: zohoResponse?.inventory_adjustment_id || null,
                status: zohoResponse?.status || null,
                date: zohoResponse?.date || null,
                referenceNumber: zohoResponse?.reference_number || referenceNumber
            },
            error: null
        });

        console.log(`✅ Approval ${approvalId} processed — Zoho adjustment ID: ${zohoResponse?.inventory_adjustment_id}`);

        res.json({
            success: true,
            message: 'Stock adjustment synced to Zoho Books',
            data: {
                approvalId,
                zohoAdjustmentId: zohoResponse?.inventory_adjustment_id,
                zohoItemId: zohoItem.item_id,
                quantityAdjusted: quantityDelta,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error(`❌ Failed to process approval ${approvalId}:`, error);

        // Record the error on the approval so admins can see it — keep processed=false so it can be retried
        try {
            const db = admin.firestore();
            await db.collection('organizations').doc(orgId)
                .collection('approvals').doc(approvalId)
                .update({
                    lastProcessAttempt: admin.firestore.FieldValue.serverTimestamp(),
                    lastProcessError: error.message
                });
        } catch (_) { /* ignore secondary failure */ }

        // Surface the real Zoho API error to the client, not just the wrapper
        const zohoMessage = error.response?.data?.message || error.message;
        res.status(500).json({
            success: false,
            message: 'Failed to sync approval to Zoho Books',
            error: zohoMessage  // real Zoho error, shown verbatim in the UI
        });
    }
});

/**
 * POST /api/zoho/sync/items
 * Sync items from StockFlow to Zoho Books
 */
router.post('/sync/items', verifyFirebaseToken, async (req, res) => {
    try {
        const { items } = req.body;
        
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Items array is required and must not be empty',
                error: 'Invalid items data'
            });
        }
        
        console.log(`🔄 Syncing ${items.length} items to Zoho Books...`);
        
        const results = {
            created: [],
            updated: [],
            failed: []
        };
        
        // Process items sequentially to avoid rate limiting
        for (const item of items) {
            try {
                let zohoItem;
                if (item.zohoItemId) {
                    // Update existing item
                    zohoItem = await zohoService.updateItem(item.zohoItemId, item);
                    results.updated.push({ 
                        stockFlowId: item.id, 
                        zohoId: item.zohoItemId, 
                        name: item.name 
                    });
                } else {
                    // Create new item
                    zohoItem = await zohoService.createItem(item);
                    results.created.push({ 
                        stockFlowId: item.id, 
                        zohoId: zohoItem.item_id, 
                        name: item.name 
                    });
                }
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`❌ Failed to sync item ${item.name}:`, error.message);
                results.failed.push({ 
                    stockFlowId: item.id, 
                    name: item.name, 
                    error: error.message 
                });
            }
        }
        
        console.log(`✅ Sync completed: ${results.created.length} created, ${results.updated.length} updated, ${results.failed.length} failed`);
        
        res.json({
            success: true,
            message: `Sync completed: ${results.created.length} created, ${results.updated.length} updated, ${results.failed.length} failed`,
            data: {
                results: results,
                summary: {
                    total: items.length,
                    created: results.created.length,
                    updated: results.updated.length,
                    failed: results.failed.length
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Bulk sync failed:', error);
        res.status(500).json({
            success: false,
            message: 'Bulk sync operation failed',
            error: error.message
        });
    }
});

/**
 * POST /api/zoho/sync-invoice-usage
 * Fetch invoices and update item lastInvoicedAt timestamps
 * This tracks actual sales/usage of items, not just stock modifications
 */
router.post('/sync-invoice-usage', verifyFirebaseToken, async (req, res) => {
    try {
        const { orgId } = req.body;
        
        if (!orgId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: orgId'
            });
        }
        
        console.log(`🧾 Syncing invoice usage data for org: ${orgId}...`);
        
        const result = await zohoService.syncInvoiceUsage(orgId);
        
        res.json({
            success: true,
            message: 'Invoice usage data synced successfully',
            data: {
                itemsUpdated: result.itemsUpdated,
                invoicesProcessed: result.invoicesProcessed,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to sync invoice usage:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to sync invoice usage data',
            error: error.response?.data?.message || error.message
        });
    }
});

/**
 * GET /api/zoho/organization
 * Get organization information from Zoho Books
 */
router.get('/organization', async (req, res) => {
    try {
        console.log('🏢 Fetching organization info from Zoho...');
        
        const organizations = await zohoService.getOrganizationInfo();
        
        res.json({
            success: true,
            data: {
                organizations: organizations,
                count: organizations.length,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ Failed to fetch organization info:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch organization information',
            error: error.message
        });
    }
});

module.exports = router;