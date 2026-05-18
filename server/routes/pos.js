/**
 * POS Integration Routes
 * Provides API endpoints for Point-of-Sale system integrations (Odoo, etc.)
 */

const express = require('express');
const router = express.Router();
const posService = require('../services/posService');
const { verifyFirebaseToken } = require('../middleware/auth');

/**
 * GET /api/pos/providers
 * List supported POS providers.
 */
router.get('/providers', verifyFirebaseToken, (req, res) => {
  try {
    const providers = posService.getProviders();
    res.json({ success: true, providers });
  } catch (error) {
    console.error('❌ Failed to list POS providers:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/pos/connect
 * Connect to a POS system. Body: { orgId, provider, baseUrl, apiKey, database? }
 */
router.post('/connect', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, provider, baseUrl, username, apiKey, database } = req.body;

    if (!orgId || !provider || !baseUrl || !apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: orgId, provider, baseUrl, apiKey',
      });
    }

    // Odoo requires a username for JSON-RPC authentication
    if (provider === 'odoo' && !username) {
      return res.status(400).json({
        success: false,
        message: 'Odoo requires a username (the login e-mail linked to your API key)',
      });
    }

    console.log(`🔌 POS connect request — org: ${orgId}, provider: ${provider}`);

    const result = await posService.connect(orgId, { provider, baseUrl, username, apiKey, database });

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    console.log(`✅ POS connected for org ${orgId} (${provider})`);
    res.json({ success: true, message: result.message });
  } catch (error) {
    console.error('❌ POS connect error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/pos/disconnect
 * Disconnect the POS integration. Body: { orgId }
 */
router.post('/disconnect', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.body;
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Missing orgId' });
    }

    console.log(`🔌 POS disconnect request — org: ${orgId}`);
    await posService.removeConfig(orgId);

    console.log(`✅ POS disconnected for org ${orgId}`);
    res.json({ success: true, message: 'POS integration disconnected' });
  } catch (error) {
    console.error('❌ POS disconnect error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/pos/test?orgId=xxx
 * Test the existing POS connection.
 */
router.get('/test', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.query;
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Missing orgId' });
    }

    const result = await posService.testConnection(orgId);
    res.json({ success: result.success, message: result.message });
  } catch (error) {
    console.error('❌ POS test error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/pos/status?orgId=xxx
 * Get POS integration status and config (without the API key).
 */
router.get('/status', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId } = req.query;
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Missing orgId' });
    }

    const config = await posService.getConfig(orgId);
    if (!config) {
      return res.json({
        success: true,
        data: { status: 'disconnected' },
      });
    }

    // Never send the API key to the frontend
    const { apiKey, ...safeConfig } = config;
    res.json({ success: true, data: safeConfig });
  } catch (error) {
    console.error('❌ POS status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/pos/items?orgId=xxx&page=1&limit=200&search=
 * Fetch products from the POS system.
 */
router.get('/items', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, page = '1', limit = '200', search = '' } = req.query;
    if (!orgId) {
      return res.status(400).json({ success: false, message: 'Missing orgId' });
    }

    console.log(`📦 POS items request — org: ${orgId}, page: ${page}`);

    const result = await posService.fetchProducts(orgId, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
    });

    console.log(`✅ POS returned ${result.items.length} items (total: ${result.total})`);

    res.json({
      success: true,
      data: {
        items: result.items,
        count: result.items.length,
        total: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    console.error('❌ POS items error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/pos/adjust-inventory
 * Adjust the on-hand quantity of a product in the POS system.
 * Body: { orgId, posId, newQuantity, reason? }
 */
router.post('/adjust-inventory', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, posId, newQuantity, reason } = req.body;
    if (!orgId || !posId || newQuantity === undefined || newQuantity === null) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: orgId, posId, newQuantity',
      });
    }

    const qty = Number(newQuantity);
    if (isNaN(qty) || qty < 0) {
      return res.status(400).json({ success: false, message: 'newQuantity must be a non-negative number' });
    }

    console.log(`📦 POS adjust inventory — org: ${orgId}, posId: ${posId}, qty: ${qty}`);

    const result = await posService.adjustInventory(orgId, posId, qty, reason);

    console.log(`✅ POS inventory adjusted for posId ${posId} → ${qty}`);
    res.json({ success: true, message: result.message || 'Inventory adjusted' });
  } catch (error) {
    // Use 400 for user-actionable config errors (e.g. wrong product type in Odoo), 500 for unexpected failures
    const statusCode = error.userError ? 400 : 500;
    if (statusCode === 500) console.error('❌ POS adjust inventory error:', error);
    res.status(statusCode).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/pos/products
 * Create a new product in the POS system.
 * Body: { orgId, productData: { name, sku, price, cost, category, ... } }
 */
router.post('/products', verifyFirebaseToken, async (req, res) => {
  try {
    const { orgId, productData } = req.body;
    if (!orgId || !productData || !productData.name) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: orgId, productData.name',
      });
    }

    console.log(`➕ POS create product — org: ${orgId}, name: ${productData.name}`);

    const result = await posService.createProduct(orgId, productData);

    console.log(`✅ POS product created — posId: ${result.posId}`);
    res.json({ success: true, posId: result.posId });
  } catch (error) {
    console.error('❌ POS create product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/pos/products/:posId
 * Update an existing product's metadata in the POS system.
 * Body: { orgId, productData }
 */
router.put('/products/:posId', verifyFirebaseToken, async (req, res) => {
  try {
    const { posId } = req.params;
    const { orgId, productData } = req.body;
    if (!orgId || !posId) {
      return res.status(400).json({ success: false, message: 'Missing orgId or posId' });
    }

    console.log(`✏️ POS update product — org: ${orgId}, posId: ${posId}`);

    await posService.updateProduct(orgId, posId, productData || {});

    console.log(`✅ POS product updated — posId: ${posId}`);
    res.json({ success: true, message: 'Product updated in POS' });
  } catch (error) {
    console.error('❌ POS update product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/pos/products/:posId
 * Archive (soft-delete) a product in the POS system.
 * Body: { orgId }
 */
router.delete('/products/:posId', verifyFirebaseToken, async (req, res) => {
  try {
    const { posId } = req.params;
    const { orgId } = req.body;
    if (!orgId || !posId) {
      return res.status(400).json({ success: false, message: 'Missing orgId or posId' });
    }

    console.log(`🗑️ POS delete product — org: ${orgId}, posId: ${posId}`);

    await posService.deleteProduct(orgId, posId);

    console.log(`✅ POS product archived — posId: ${posId}`);
    res.json({ success: true, message: 'Product archived in POS' });
  } catch (error) {
    console.error('❌ POS delete product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
