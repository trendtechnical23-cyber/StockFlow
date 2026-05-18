/**
 * POS Integration Service
 * Business-logic layer that manages POS credentials in Firestore
 * and delegates product fetches to the correct adapter.
 */

const admin = require('firebase-admin');
const { createAdapter, listProviders } = require('./posAdapters');

class PosService {
  /**
   * Path helper: organizations/{orgId}/integrations/pos
   */
  _configRef(orgId) {
    return admin.firestore().collection('organizations').doc(orgId);
  }

  /**
   * Read stored POS config for an organization.
   * @returns {Promise<object|null>}
   */
  async getConfig(orgId) {
    const snap = await this._configRef(orgId).get();
    const data = snap.data();
    return data?.integrations?.pos || null;
  }

  /**
   * Save POS connection config to Firestore.
   */
  async storeConfig(orgId, { provider, baseUrl, username, apiKey, database }) {
    const ref = this._configRef(orgId);
    await ref.set(
      {
        integrations: {
          pos: {
            status: 'connected',
            provider,
            baseUrl,
            username: username || null,
            apiKey,          // stored encrypted at rest via Firestore
            database: database || null,
            connectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      { merge: true }
    );
  }

  /**
   * Remove POS integration for an organization.
   */
  async removeConfig(orgId) {
    const ref = this._configRef(orgId);
    await ref.set(
      {
        integrations: {
          pos: {
            status: 'disconnected',
            provider: admin.firestore.FieldValue.delete(),
            username: admin.firestore.FieldValue.delete(),
            apiKey: admin.firestore.FieldValue.delete(),
            baseUrl: admin.firestore.FieldValue.delete(),
            database: admin.firestore.FieldValue.delete(),
            connectedAt: admin.firestore.FieldValue.delete(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      { merge: true }
    );
  }

  /**
   * Instantiate the correct adapter from Firestore config.
   */
  async _adapterForOrg(orgId) {
    const config = await this.getConfig(orgId);
    if (!config || config.status !== 'connected') {
      throw new Error('POS integration is not connected for this organization');
    }
    return createAdapter(config.provider, {
      baseUrl: config.baseUrl,
      username: config.username,
      apiKey: config.apiKey,
      database: config.database,
    });
  }

  /**
   * Connect + test: validate credentials, then persist.
   */
  async connect(orgId, { provider, baseUrl, username, apiKey, database }) {
    // 1. Create adapter with the provided credentials and test
    const adapter = createAdapter(provider, { baseUrl, username, apiKey, database });
    const testResult = await adapter.testConnection();
    if (!testResult.success) {
      return testResult;
    }

    // 2. Persist to Firestore
    await this.storeConfig(orgId, { provider, baseUrl, username, apiKey, database });

    return { success: true, message: testResult.message };
  }

  /**
   * Test an existing connection.
   */
  async testConnection(orgId) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.testConnection();
  }

  /**
   * Fetch products through the adapter.
   */
  async fetchProducts(orgId, options = {}) {
    const adapter = await this._adapterForOrg(orgId);
    const result = await adapter.fetchProducts(options);

    // Map raw items to StockFlow format
    const mappedItems = result.items.map((item) => adapter.mapToInventoryItem(item));

    return {
      items: mappedItems,
      rawItems: result.items,
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  /**
   * Fetch a single product.
   */
  async getProduct(orgId, productId) {
    const adapter = await this._adapterForOrg(orgId);
    const raw = await adapter.getProduct(productId);
    return {
      item: adapter.mapToInventoryItem(raw),
      raw,
    };
  }

  /**
   * Adjust on-hand inventory quantity for a product in the POS system.
   * @param {string} orgId
   * @param {string} posId         POS-side product ID
   * @param {number} newQuantity   New on-hand quantity
   * @param {string} [reason]      Optional reason for the adjustment
   */
  async adjustInventory(orgId, posId, newQuantity, reason = 'StockFlow adjustment') {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.adjustInventory(posId, newQuantity, reason);
  }

  /**
   * Create a new product in the POS system and return its posId.
   * @param {string} orgId
   * @param {object} productData  Fields from InventoryItem
   * @returns {Promise<{posId: string}>}
   */
  async createProduct(orgId, productData) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.createProduct(productData);
  }

  /**
   * Update metadata of an existing POS product.
   * @param {string} orgId
   * @param {string} posId
   * @param {object} productData  Partial fields to update
   */
  async updateProduct(orgId, posId, productData) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.updateProduct(posId, productData);
  }

  /**
   * Delete (archive) a product in the POS system.
   * @param {string} orgId
   * @param {string} posId
   */
  async deleteProduct(orgId, posId) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.deleteProduct(posId);
  }

  /**
   * List supported POS providers.
   */
  getProviders() {
    return listProviders().map((p) => ({
      id: p,
      name: p.charAt(0).toUpperCase() + p.slice(1),
    }));
  }
}

module.exports = new PosService();
