/**
 * Odoo POS Adapter
 * Implements the standard Odoo JSON-RPC 2.0 API for inventory sync.
 *
 * Auth flow:
 *   1. POST /jsonrpc  service=common  method=authenticate  → obtains uid
 *   2. POST /jsonrpc  service=object  method=execute_kw    → data operations
 *
 * API key replaces the password in the authenticate call (Odoo ≥ 14).
 * Username is the login e-mail of the user who generated the key.
 */

const axios = require('axios');
const BasePosAdapter = require('./basePosAdapter');

class OdooAdapter extends BasePosAdapter {
  constructor(config) {
    super(config);
    // config = { baseUrl, username, apiKey, database? }
    this.baseUrl = config.baseUrl.replace(/\/+$/, ''); // strip trailing slash
    this.username = config.username;
    this.apiKey = config.apiKey;
    this.database = config.database || null;
    this._uid = null; // cached after first authenticate
  }

  get provider() {
    return 'odoo';
  }

  /** Standard JSON-RPC request headers. */
  _headers() {
    return { 'Content-Type': 'application/json' };
  }

  /**
   * Try to infer the database name from the URL when not explicitly provided.
   * For Odoo SaaS (*.odoo.com) the DB name equals the subdomain.
   */
  _inferDatabase() {
    if (this.database) return this.database;
    try {
      const hostname = new URL(this.baseUrl).hostname; // e.g. "mycompany.odoo.com"
      return hostname.split('.')[0]; // "mycompany"
    } catch {
      return null;
    }
  }

  /**
   * Low-level JSON-RPC wrapper.
   * @param {string} service  'common' | 'object'
   * @param {string} method   RPC method name
   * @param {Array}  args     Positional arguments
   */
  async _rpc(service, method, args = []) {
    const url = `${this.baseUrl}/jsonrpc`;
    const body = {
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: { service, method, args },
    };
    const response = await axios.post(url, body, {
      headers: this._headers(),
      timeout: 30000,
    });

    const data = response.data;
    if (data.error) {
      const msg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
      throw new Error(`Odoo RPC error: ${msg}`);
    }
    return data.result;
  }

  /**
   * Authenticate once and cache the uid.
   */
  async _authenticate() {
    if (this._uid) return this._uid;
    const db = this._inferDatabase();
    if (!db) throw new Error('Could not determine Odoo database name — please enter it manually');

    const uid = await this._rpc('common', 'authenticate', [db, this.username, this.apiKey, {}]);
    if (!uid) {
      throw new Error('Authentication failed — check your username and API key');
    }
    this._uid = uid;
    return uid;
  }

  /**
   * Execute a model method via JSON-RPC execute_kw.
   * @param {string} model   e.g. 'product.product'
   * @param {string} method  e.g. 'search_read'
   * @param {Array}  args    Positional args (usually [[domain]])
   * @param {object} kwargs  Keyword args (fields, limit, offset, order …)
   */
  async _call(model, method, args = [], kwargs = {}) {
    const uid = await this._authenticate();
    const db = this._inferDatabase();
    return this._rpc('object', 'execute_kw', [db, uid, this.apiKey, model, method, args, kwargs]);
  }

  // ------- Public adapter interface -------

  async testConnection() {
    try {
      // Step 1: verify the URL resolves and is an Odoo instance
      const version = await this._rpc('common', 'version', []);
      if (!version || !version.server_version) {
        return { success: false, message: 'Unexpected response from server — is this an Odoo instance?' };
      }

      // Step 2: test authentication
      await this._authenticate();

      return {
        success: true,
        message: `Connected to Odoo ${version.server_version}`,
      };
    } catch (error) {
      const status = error.response?.status;
      let msg;
      if (status === 404) {
        msg = 'Odoo /jsonrpc endpoint not found — check the URL (e.g. https://mycompany.odoo.com)';
      } else if (status === 401 || (error.message && error.message.includes('Authentication failed'))) {
        msg = 'Authentication failed — check your username and API key';
      } else {
        msg = error.message;
      }
      return { success: false, message: msg };
    }
  }

  async fetchProducts(options = {}) {
    const { page = 1, limit = 200, search = '' } = options;
    const offset = (page - 1) * limit;

    const domain = [['active', '=', true]];
    if (search) {
      domain.push('|', ['name', 'ilike', search], ['default_code', 'ilike', search]);
    }

    const fields = [
      'name',
      'default_code',
      'qty_available',
      'list_price',
      'standard_price',
      'categ_id',
      'barcode',
      'uom_id',
      'active',
      'type',
    ];

    const [items, total] = await Promise.all([
      this._call('product.product', 'search_read', [domain], {
        fields,
        limit,
        offset,
        order: 'name asc',
      }),
      this._call('product.product', 'search_count', [domain]),
    ]);

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  async getProduct(productId) {
    const items = await this._call(
      'product.product',
      'search_read',
      [[['id', '=', Number(productId)]]],
      {
        fields: [
          'name',
          'default_code',
          'qty_available',
          'list_price',
          'standard_price',
          'categ_id',
          'barcode',
          'uom_id',
          'active',
          'type',
        ],
        limit: 1,
      }
    );
    if (!items || items.length === 0) {
      throw new Error(`Product ${productId} not found in Odoo`);
    }
    return items[0];
  }

  /**
   * Map an Odoo product.product record into a StockFlow InventoryItem shape.
   */
  mapToInventoryItem(odooItem) {
    // categ_id comes as [id, "Category / Subcategory"]
    const categoryName =
      Array.isArray(odooItem.categ_id) && odooItem.categ_id.length === 2
        ? odooItem.categ_id[1]
        : 'Uncategorized';

    const uom =
      Array.isArray(odooItem.uom_id) && odooItem.uom_id.length === 2
        ? odooItem.uom_id[1]
        : undefined;

    return {
      name: odooItem.name || 'Unnamed Product',
      sku: odooItem.default_code || `ODOO-${odooItem.id}`,
      category: categoryName,
      stock: odooItem.qty_available ?? 0,
      price: odooItem.list_price ?? 0,
      cost: odooItem.standard_price ?? 0,
      threshold: 0,
      supplier: '',
      source: 'pos',
      posId: String(odooItem.id),
      posProvider: 'odoo',
      barcode: odooItem.barcode || null,
      metadata: {
        unit: uom,
        description: '',
        location: '',
      },
    };
  }

  getSupportedFields() {
    return ['name', 'sku', 'quantity', 'price', 'cost', 'category', 'barcode', 'unit'];
  }

  // ------- Write-back methods -------

  /**
   * Adjust stock on-hand in Odoo using stock.quant + action_apply_inventory.
   * This is the correct Odoo pattern — it creates a proper Stock Move and
   * accounting journal entry, just like an Inventory Adjustment in the UI.
   */
  async adjustInventory(productId, newQuantity, reason = 'StockFlow adjustment') {
    const id = Number(productId);

    // 0. Verify the product exists and is Storable — consumables/services don't track stock
    const products = await this._call(
      'product.product',
      'search_read',
      [[['id', '=', id]]],
      { fields: ['type', 'name'], limit: 1 }
    );
    if (!products || products.length === 0) {
      throw new Error(`Product ${productId} not found in Odoo`);
    }
    if (products[0].type !== 'product') {
      const typeLabel = products[0].type === 'consu' ? 'Consumable' : 'Service';
      const err = new Error(
        `"${products[0].name}" is set as ${typeLabel} in Odoo. ` +
        `Change its Product Type to "Storable Product" in Odoo to enable stock tracking.`
      );
      err.userError = true;
      throw err;
    }

    // 1. Find the WH/Stock internal location ID
    const locations = await this._call(
      'stock.location',
      'search_read',
      [[['complete_name', 'ilike', 'WH/Stock'], ['usage', '=', 'internal']]],
      { fields: ['id', 'complete_name'], limit: 1 }
    );
    if (!locations || locations.length === 0) {
      throw new Error('Could not find WH/Stock location in Odoo');
    }
    const locationId = locations[0].id;

    // 2. Find existing stock.quant record for this product + location
    const quants = await this._call(
      'stock.quant',
      'search_read',
      [[['product_id', '=', id], ['location_id', '=', locationId]]],
      { fields: ['id', 'quantity', 'inventory_quantity'], limit: 1 }
    );

    let quantId;
    if (quants && quants.length > 0) {
      quantId = quants[0].id;
      // Update the inventory_quantity field (the "counted" quantity)
      await this._call('stock.quant', 'write', [[quantId], { inventory_quantity: newQuantity }]);
    } else {
      // Create a new quant record (Odoo will create the stock move when we apply)
      quantId = await this._call('stock.quant', 'create', [{
        product_id: id,
        location_id: locationId,
        inventory_quantity: newQuantity,
      }]);
    }

    // 3. Apply the inventory adjustment — this creates the Stock Move + journal entry
    await this._call('stock.quant', 'action_apply_inventory', [[quantId]]);

    return { success: true, message: `Inventory adjusted to ${newQuantity} units in Odoo` };
  }

  /**
   * Create a new storable product in Odoo.
   * Returns the new product's ID as posId.
   */
  async createProduct(productData) {
    const { name, sku, price = 0, cost = 0, category, description } = productData;

    // Build the create payload
    const payload = {
      name: name || 'New Product',
      default_code: sku || '',
      list_price: price,
      standard_price: cost,
      type: 'product', // 'product' = storable, tracks inventory
    };

    // If category provided, try to find/create the category
    if (category) {
      const cats = await this._call(
        'product.category',
        'search_read',
        [[['name', '=', category]]],
        { fields: ['id'], limit: 1 }
      );
      if (cats && cats.length > 0) {
        payload.categ_id = cats[0].id;
      }
    }

    // product.template create returns the new template ID
    const templateId = await this._call('product.template', 'create', [payload]);

    // Get the auto-created product.product ID for future reference
    const products = await this._call(
      'product.product',
      'search_read',
      [[['product_tmpl_id', '=', templateId]]],
      { fields: ['id'], limit: 1 }
    );

    const posId = products && products.length > 0 ? String(products[0].id) : String(templateId);
    return { posId };
  }

  /**
   * Update an existing product's metadata in Odoo.
   * Does not change stock — use adjustInventory() for that.
   */
  async updateProduct(productId, productData) {
    const id = Number(productId);
    const { name, price, cost, sku, description } = productData;

    // Get the template ID from the product ID
    const products = await this._call(
      'product.product',
      'search_read',
      [[['id', '=', id]]],
      { fields: ['id', 'product_tmpl_id'], limit: 1 }
    );

    if (!products || products.length === 0) {
      throw new Error(`Product ${productId} not found in Odoo`);
    }

    const templateId = Array.isArray(products[0].product_tmpl_id)
      ? products[0].product_tmpl_id[0]
      : products[0].product_tmpl_id;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (price !== undefined) updates.list_price = price;
    if (cost !== undefined) updates.standard_price = cost;
    if (sku !== undefined) updates.default_code = sku;
    if (description !== undefined) updates.description_sale = description;

    if (Object.keys(updates).length > 0) {
      await this._call('product.template', 'write', [[templateId], updates]);
    }
  }

  /**
   * Archive (soft-delete) a product in Odoo.
   * Odoo does not hard-delete products with transaction history.
   */
  async deleteProduct(productId) {
    const id = Number(productId);
    // Archiving sets active=False which removes it from all searches
    await this._call('product.product', 'write', [[id], { active: false }]);
  }
}

module.exports = OdooAdapter;
