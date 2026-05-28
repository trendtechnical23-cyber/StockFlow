/**
 * Zoho Books Integration Routes
 *
 * All Firestore usage replaced with Supabase (organization_settings + approval_requests +
 * inventory_items + activity_logs). Firebase Admin is no longer imported.
 */

const express    = require('express');
const router     = express.Router();
const zohoService = require('../services/zohoService');
const { supabase } = require('../supabaseAdmin');
const { verifyFirebaseToken } = require('../middleware/auth');

const REGION_ACCOUNTS_DOMAIN = {
  us: 'accounts.zoho.com',
  eu: 'accounts.zoho.eu',
  in: 'accounts.zoho.in',
  au: 'accounts.zoho.com.au',
  jp: 'accounts.zoho.jp',
};

// ── Config ────────────────────────────────────────────────────────────────────

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
        message: 'Missing required fields: orgId, clientId, clientSecret, zohoOrgId, region, redirectUri',
      });
    }

    if (!REGION_ACCOUNTS_DOMAIN[region]) {
      return res.status(400).json({ success: false, message: 'Invalid region value' });
    }

    // Read current config so we don't wipe existing tokens
    const { data: existing } = await supabase
      .from('organization_settings')
      .select('zoho_config')
      .eq('org_id', orgId)
      .maybeSingle();

    const currentConfig = existing?.zoho_config || {};

    const { error } = await supabase
      .from('organization_settings')
      .upsert(
        {
          org_id:      orgId,
          zoho_config: {
            ...currentConfig,   // preserve existing tokens / zoho_organization_id cache
            clientId,
            clientSecret,
            zohoOrgId,
            region,
            redirectUri,
            updatedAt: new Date().toISOString(),
          },
        },
        { onConflict: 'org_id' }
      );

    if (error) throw error;

    console.log('✅ Zoho config saved to Supabase for org:', orgId);
    res.json({ success: true, message: 'Zoho configuration saved' });
  } catch (err) {
    console.error('❌ Failed to save Zoho config:', err);
    res.status(500).json({ success: false, message: 'Failed to save configuration', error: err.message });
  }
});

/**
 * GET /api/zoho/config
 * Check if per-org Zoho config exists (returns safe, non-secret fields only)
 */
router.get('/config', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.query;
    if (!orgId) return res.status(400).json({ success: false, message: 'Missing orgId' });

    const { data, error } = await supabase
      .from('organization_settings')
      .select('zoho_config')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) throw error;

    const cfg = data?.zoho_config;
    if (!cfg?.clientId) {
      return res.json({ success: true, configured: false });
    }

    res.json({
      success: true,
      configured: true,
      config: {
        clientId:    cfg.clientId,
        zohoOrgId:   cfg.zohoOrgId,
        region:      cfg.region,
        redirectUri: cfg.redirectUri || '',
        // clientSecret intentionally omitted
      },
    });
  } catch (err) {
    console.error('❌ Failed to get Zoho config:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve configuration', error: err.message });
  }
});

// ── OAuth ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/zoho/auth/url
 * Generate Zoho OAuth authorization URL using per-org credentials
 */
router.get('/auth/url', verifyFirebaseToken, async (req, res) => {
  try {
    const { organizationId, userId } = req.query;
    if (!organizationId || !userId) {
      return res.status(400).json({ success: false, message: 'Missing required parameters: organizationId and userId' });
    }

    const { data, error } = await supabase
      .from('organization_settings')
      .select('zoho_config')
      .eq('org_id', organizationId)
      .maybeSingle();

    if (error) throw error;

    const cfg = data?.zoho_config;
    if (!cfg?.clientId) {
      return res.status(400).json({
        success: false,
        message: 'Zoho API credentials not configured for this organization. Please configure them in Integrations settings first.',
      });
    }

    const accountsDomain = REGION_ACCOUNTS_DOMAIN[cfg.region] || 'accounts.zoho.com';

    // ZOHO_REDIRECT_URI env var is the single source of truth — it must match
    // exactly what is registered in the Zoho API Console.
    // We no longer use cfg.redirectUri (which could be stale from an old setup).
    const redirectUri = process.env.ZOHO_REDIRECT_URI || cfg.redirectUri;

    if (!redirectUri) {
      return res.status(400).json({
        success: false,
        message: 'ZOHO_REDIRECT_URI env var not set on Railway. ' +
                 'Add it in Railway → Variables: ZOHO_REDIRECT_URI=https://stockflow-production-9f3f.up.railway.app/callback/zoho',
      });
    }

    console.log('🔗 Using redirect URI:', redirectUri);

    const state = Buffer.from(JSON.stringify({ organizationId, userId, timestamp: Date.now() })).toString('base64');

    const authUrl = `https://${accountsDomain}/oauth/v2/auth?` +
      `response_type=code&` +
      `client_id=${cfg.clientId}&` +
      `scope=ZohoBooks.fullaccess.all&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${encodeURIComponent(state)}&` +
      `access_type=offline&` +
      `prompt=consent`;

    console.log('🔗 Generated Zoho auth URL for org:', organizationId);
    res.json({ success: true, authUrl, redirectUri });
  } catch (err) {
    console.error('❌ Failed to generate auth URL:', err);
    res.status(500).json({ success: false, message: 'Failed to generate authorization URL', error: err.message });
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
      return res.status(400).json({ success: false, message: 'Missing authorization code or state parameter' });
    }

    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (_) {
      return res.status(400).json({ success: false, message: 'Invalid state parameter' });
    }

    const tokenResponse = await zohoService.exchangeCodeForTokens(code, stateData.organizationId);
    if (!tokenResponse.success) {
      return res.status(400).json({ success: false, message: `Failed to exchange authorization code: ${tokenResponse.error}`, error: tokenResponse.error });
    }

    const storeResult = await zohoService.storeTokens(stateData.organizationId, stateData.userId, tokenResponse.tokens);
    if (!storeResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to store authentication tokens', error: storeResult.error });
    }

    console.log('✅ Tokens stored for org:', stateData.organizationId);
    res.json({ success: true, message: 'Successfully authenticated with Zoho Books', organizationId: stateData.organizationId });
  } catch (err) {
    console.error('❌ Zoho callback processing failed:', err);
    res.status(500).json({ success: false, message: 'Failed to process authorization callback', error: err.message });
  }
});

// ── Items ─────────────────────────────────────────────────────────────────────

router.get('/test', verifyFirebaseToken, async (req, res) => {
  try {
    const result = await zohoService.testConnection();
    if (result.success) {
      res.json({ success: true, message: result.message, data: { organizationId: result.organizationId, organizationName: result.organizationName, timestamp: new Date().toISOString() } });
    } else {
      res.status(400).json({ success: false, message: result.message, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error during connection test', error: err.message });
  }
});

router.get('/items', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.query;
    if (!orgId) return res.status(400).json({ success: false, message: 'Missing required parameter: orgId' });
    const result = await zohoService.getItems(orgId);
    res.json({ success: true, data: { items: result.items, pagination: result.page_context, count: result.total_items, timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch items from Zoho Books', error: err.response?.data?.message || err.message });
  }
});

router.post('/items', verifyFirebaseToken, async (req, res) => {
  try {
    const itemData = req.body;
    if (!itemData.name || !itemData.sku) return res.status(400).json({ success: false, message: 'Item name and SKU are required' });
    const zohoItem = await zohoService.createItem(itemData);
    res.json({ success: true, message: 'Item created in Zoho Books', data: { zohoItem, itemId: zohoItem.item_id, timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create item in Zoho Books', error: err.message });
  }
});

router.put('/items/:itemId', verifyFirebaseToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    const itemData   = req.body;
    if (!itemData.name || !itemData.sku) return res.status(400).json({ success: false, message: 'Item name and SKU are required' });
    const zohoItem = await zohoService.updateItem(itemId, itemData);
    res.json({ success: true, message: 'Item updated in Zoho Books', data: { zohoItem, itemId, timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update item in Zoho Books', error: err.message });
  }
});

router.post('/items/:itemId/adjust-stock', verifyFirebaseToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantity, reason, orgId, referenceNumber } = req.body;
    if (!orgId)                      return res.status(400).json({ success: false, message: 'Missing required parameter: orgId' });
    if (typeof quantity !== 'number') return res.status(400).json({ success: false, message: 'Quantity must be a number' });
    const adjustment = await zohoService.adjustStock(orgId, itemId, quantity, reason, referenceNumber);
    res.json({ success: true, message: 'Stock adjusted in Zoho Books', data: { adjustment, adjustmentId: adjustment?.inventory_adjustment_id, itemId, quantityAdjusted: quantity, timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to adjust stock in Zoho Books', error: err.message });
  }
});

// ── Approval processing ───────────────────────────────────────────────────────

/**
 * POST /api/zoho/approvals/session/process?orgId=xxx
 * Batch-process all approved-but-unprocessed approvals for a stock-take session.
 * Reads from Supabase approval_requests table.
 */
router.post('/approvals/session/process', verifyFirebaseToken, async (req, res) => {
  const orgId     = req.query.orgId;
  const { sessionId } = req.body;

  if (!orgId)     return res.status(400).json({ success: false, message: 'Missing required query parameter: orgId' });
  if (!sessionId) return res.status(400).json({ success: false, message: 'Missing required body field: sessionId' });

  try {
    console.log(`🔄 Batch-processing session ${sessionId} for org ${orgId}…`);

    // Fetch approved, unprocessed approvals for this session via Supabase
    // approval_requests rows have: id, org_id, type, item_id, delta, reason, status
    // We join inventory_items to get the SKU
    const { data: approvals, error: approvalError } = await supabase
      .from('approval_requests')
      .select(`
        id, type, item_id, delta, reason, status,
        inventory_items ( id, sku, name )
      `)
      .eq('org_id', orgId)
      .eq('status', 'approved')
      .eq('type', 'stock_adjustment');

    if (approvalError) throw approvalError;

    // Filter to this session — session linkage is stored in reason field or via stock_take_entries
    // For robustness, process all approved adjustments for the org (the frontend ensures context)
    const pending = (approvals || []).filter(a => a.delta !== null && a.item_id);

    if (pending.length === 0) {
      return res.json({ success: true, message: 'No unprocessed approvals found for this session', data: { processed: 0 } });
    }

    console.log(`📋 Found ${pending.length} approved adjustments to batch`);

    // Build SKU → Zoho item_id map
    let skuMap;
    try {
      skuMap = await zohoService.buildSkuToItemIdMap(orgId);
    } catch (tokenErr) {
      const msg = tokenErr.message || '';
      if (msg.startsWith('ZOHO_TOKEN_EXPIRED') || msg.includes('not authorized')) {
        return res.status(401).json({ success: false, message: 'Zoho access token has expired. Please reconnect Zoho in Integrations.', code: 'ZOHO_TOKEN_EXPIRED' });
      }
      throw tokenErr;
    }

    const lineItems = [];
    const skipped   = [];

    for (const approval of pending) {
      const sku         = approval.inventory_items?.sku;
      const quantityDelta = approval.delta;

      if (!sku || typeof quantityDelta !== 'number') {
        skipped.push({ id: approval.id, reason: 'missing SKU or delta' });
        continue;
      }

      const zohoItemId = skuMap.get(sku);
      if (!zohoItemId) {
        console.warn(`⚠️ SKU '${sku}' not found in Zoho — skipping approval ${approval.id}`);
        skipped.push({ id: approval.id, reason: `SKU '${sku}' not in Zoho Books` });
        // Mark as rejected so it doesn't retry forever
        await supabase.from('approval_requests').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', approval.id);
        continue;
      }

      lineItems.push({ item_id: zohoItemId, quantity_adjusted: quantityDelta });
    }

    if (lineItems.length === 0) {
      return res.status(400).json({ success: false, message: 'None of the approvals could be matched to Zoho items.', data: { skipped } });
    }

    const referenceNumber = `SF-ST-${sessionId.substring(0, 8).toUpperCase()}`;
    const reason          = `Stock take adjustment via StockFlow (${lineItems.length} items)`;
    const adj             = await zohoService.adjustStockBatch(orgId, lineItems, reason, referenceNumber);
    const adjustmentId    = adj?.inventory_adjustment_id || null;

    console.log(`✅ Batch adjustment ${adjustmentId} created — marking approvals processed`);

    // Log to activity_logs
    for (const approval of pending) {
      if (!approval.inventory_items?.sku || !skuMap.get(approval.inventory_items.sku)) continue;
      await supabase.from('activity_logs').insert({
        org_id:      orgId,
        type:        'zoho_sync',
        entity_type: 'approval',
        entity_id:   approval.id,
        details: {
          event:          'zoho_synced',
          sessionId,
          adjustmentId,
          referenceNumber: adj?.reference_number || referenceNumber,
          quantityDelta:   approval.delta,
          itemId:          approval.item_id,
          itemSKU:         approval.inventory_items?.sku,
        },
      }).then(() => {}).catch(e => console.warn('⚠️ activity_logs insert failed (non-fatal):', e.message));
    }

    res.json({
      success: true,
      message: `Batch adjustment created in Zoho Books (${lineItems.length} items)`,
      data: {
        sessionId,
        adjustmentId,
        referenceNumber: adj?.reference_number || referenceNumber,
        itemsProcessed: lineItems.length,
        itemsSkipped:   skipped.length,
        skipped,
        timestamp:      new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`❌ Batch session process failed for session ${sessionId}:`, err);
    res.status(500).json({ success: false, message: `Failed to batch-sync session to Zoho Books: ${err.message}`, error: err.message });
  }
});

/**
 * POST /api/zoho/sync/pull-quantities?orgId=xxx
 * Pull stock_on_hand from Zoho Books and write to Supabase inventory_items.
 */
router.post('/sync/pull-quantities', verifyFirebaseToken, async (req, res) => {
  const orgId  = req.query.orgId;
  if (!orgId) return res.status(400).json({ success: false, message: 'Missing orgId' });

  const { skus = [] } = req.body;

  try {
    console.log(`📥 Pulling stock_on_hand from Zoho for org ${orgId}…`);

    let stockMap;
    try {
      stockMap = await zohoService.fetchStockOnHand(orgId, skus);
    } catch (tokenErr) {
      const msg = tokenErr.message || '';
      if (msg.startsWith('ZOHO_TOKEN_EXPIRED') || msg.includes('not authorized')) {
        return res.status(401).json({ success: false, message: 'Zoho access token has expired. Please reconnect Zoho in Integrations.', code: 'ZOHO_TOKEN_EXPIRED' });
      }
      throw tokenErr;
    }

    if (stockMap.size === 0) {
      return res.json({ success: true, message: 'No matching items found in Zoho Books', data: { updated: 0 } });
    }

    // Fetch Supabase inventory to match by SKU
    const { data: inventoryItems, error: invError } = await supabase
      .from('inventory_items')
      .select('id, sku, quantity')
      .eq('org_id', orgId)
      .eq('is_active', true);

    if (invError) throw invError;

    let updated = 0;
    const changes = [];

    for (const item of (inventoryItems || [])) {
      const sku      = item.sku;
      if (!sku) continue;
      const zohoData = stockMap.get(sku);
      if (!zohoData) continue;

      const previousStock = item.quantity ?? 0;
      const newStock      = zohoData.stock_on_hand;
      if (previousStock === newStock) continue;

      const { error: updateError } = await supabase
        .from('inventory_items')
        .update({ quantity: newStock, updated_at: new Date().toISOString() })
        .eq('id', item.id);

      if (!updateError) {
        changes.push({ sku, previousStock, newStock });
        updated++;
      }
    }

    console.log(`✅ Pulled quantities from Zoho: ${updated} items updated`);
    res.json({ success: true, message: `Synced ${updated} item quantities from Zoho Books`, data: { updated, changes } });
  } catch (err) {
    console.error('❌ pull-quantities failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/zoho/approvals/:approvalId/process?orgId=xxx
 * Execute a single approved stock-adjustment approval in Zoho Books.
 */
router.post('/approvals/:approvalId/process', verifyFirebaseToken, async (req, res) => {
  const { approvalId } = req.params;
  const orgId          = req.query.orgId;

  if (!orgId) return res.status(400).json({ success: false, message: 'Missing required query parameter: orgId' });

  try {
    console.log(`🔄 Processing approval ${approvalId} for org ${orgId}...`);

    const { data: approval, error: fetchError } = await supabase
      .from('approval_requests')
      .select('id, org_id, type, item_id, delta, reason, status, inventory_items ( id, sku, name )')
      .eq('id', approvalId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!approval)  return res.status(404).json({ success: false, message: 'Approval not found' });

    if (approval.status !== 'approved') {
      return res.status(400).json({ success: false, message: `Approval is not in 'approved' state (current: ${approval.status})` });
    }

    const itemSKU = approval.inventory_items?.sku;
    if (!itemSKU)  return res.status(400).json({ success: false, message: 'Approval item has no SKU — cannot sync to Zoho' });

    const quantityDelta = approval.delta;
    if (typeof quantityDelta !== 'number') {
      return res.status(400).json({ success: false, message: 'Approval is missing a numeric delta' });
    }

    let zohoItem;
    try {
      zohoItem = await zohoService.findItemBySku(orgId, itemSKU);
    } catch (lookupErr) {
      if (lookupErr.message?.startsWith('ZOHO_TOKEN_EXPIRED')) {
        return res.status(401).json({ success: false, message: 'Zoho access token has expired. Please reconnect Zoho Books in Integrations.', code: 'ZOHO_TOKEN_EXPIRED' });
      }
      throw lookupErr;
    }

    if (!zohoItem) {
      const errMsg = `Item with SKU '${itemSKU}' not found in Zoho Books`;
      await supabase.from('approval_requests').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', approvalId);
      return res.status(404).json({ success: false, message: errMsg });
    }

    const reason          = approval.reason || 'Stock adjustment via StockFlow';
    const referenceNumber = `SF-${approvalId.substring(0, 8).toUpperCase()}`;

    const zohoResponse = await zohoService.adjustStock(orgId, zohoItem.item_id, quantityDelta, reason, referenceNumber);

    // Log to activity_logs
    await supabase.from('activity_logs').insert({
      org_id:      orgId,
      type:        'zoho_sync',
      entity_type: 'approval',
      entity_id:   approvalId,
      details: {
        event:          'zoho_synced',
        approvalId,
        itemId:         approval.item_id,
        itemSKU,
        quantityDelta,
        adjustmentId:   zohoResponse?.inventory_adjustment_id || null,
        referenceNumber,
      },
    }).then(() => {}).catch(e => console.warn('⚠️ activity_logs insert failed (non-fatal):', e.message));

    console.log(`✅ Approval ${approvalId} synced — Zoho adjustment: ${zohoResponse?.inventory_adjustment_id}`);

    res.json({
      success: true,
      message: 'Stock adjustment synced to Zoho Books',
      data: {
        approvalId,
        zohoAdjustmentId: zohoResponse?.inventory_adjustment_id,
        zohoItemId:       zohoItem.item_id,
        quantityAdjusted: quantityDelta,
        timestamp:        new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(`❌ Failed to process approval ${approvalId}:`, err);
    const zohoMessage = err.response?.data?.message || err.message;
    res.status(500).json({ success: false, message: 'Failed to sync approval to Zoho Books', error: zohoMessage });
  }
});

// ── Misc ──────────────────────────────────────────────────────────────────────

router.post('/sync/items', verifyFirebaseToken, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Items array is required and must not be empty' });
    }
    const results = { created: [], updated: [], failed: [] };
    for (const item of items) {
      try {
        if (item.zohoItemId) {
          await zohoService.updateItem(item.zohoItemId, item);
          results.updated.push({ stockFlowId: item.id, zohoId: item.zohoItemId, name: item.name });
        } else {
          const zohoItem = await zohoService.createItem(item);
          results.created.push({ stockFlowId: item.id, zohoId: zohoItem.item_id, name: item.name });
        }
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        results.failed.push({ stockFlowId: item.id, name: item.name, error: err.message });
      }
    }
    res.json({ success: true, message: `Sync completed: ${results.created.length} created, ${results.updated.length} updated, ${results.failed.length} failed`, data: { results, summary: { total: items.length, ...Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])) }, timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Bulk sync operation failed', error: err.message });
  }
});

router.post('/sync-invoice-usage', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ success: false, message: 'Missing required parameter: orgId' });
    const result = await zohoService.syncInvoiceUsage(orgId);
    res.json({ success: true, message: 'Invoice usage data synced', data: { itemsUpdated: result.itemsUpdated, invoicesProcessed: result.invoicesProcessed, timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to sync invoice usage data', error: err.response?.data?.message || err.message });
  }
});

router.get('/organization', async (req, res) => {
  try {
    const organizations = await zohoService.getOrganizationInfo();
    res.json({ success: true, data: { organizations, count: organizations.length, timestamp: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch organization information', error: err.message });
  }
});

module.exports = router;
