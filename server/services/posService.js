/**
 * POS Integration Service
 * Stores POS credentials in Supabase organization_settings.pos_config (JSONB)
 * and delegates product fetches to the correct adapter.
 */

const { supabase } = require('../supabaseAdmin');
const { createAdapter, listProviders } = require('./posAdapters');

class PosService {
  /**
   * Read stored POS config for an organization.
   * @returns {Promise<object|null>}
   */
  async getConfig(orgId) {
    const { data, error } = await supabase
      .from('organization_settings')
      .select('pos_config')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) throw error;
    return data?.pos_config || null;
  }

  /**
   * Save POS connection config to Supabase.
   */
  async storeConfig(orgId, { provider, baseUrl, username, apiKey, database }) {
    const config = {
      status: 'connected',
      provider,
      baseUrl,
      username: username || null,
      apiKey,
      database: database || null,
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('organization_settings')
      .upsert({ org_id: orgId, pos_config: config, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });

    if (error) throw error;
  }

  /**
   * Remove POS integration for an organization.
   */
  async removeConfig(orgId) {
    const { error } = await supabase
      .from('organization_settings')
      .upsert(
        { org_id: orgId, pos_config: { status: 'disconnected', updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: 'org_id' }
      );
    if (error) throw error;
  }

  /**
   * Instantiate the correct adapter from stored config.
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
    const adapter = createAdapter(provider, { baseUrl, username, apiKey, database });
    const testResult = await adapter.testConnection();
    if (!testResult.success) return testResult;
    await this.storeConfig(orgId, { provider, baseUrl, username, apiKey, database });
    return { success: true, message: testResult.message };
  }

  async testConnection(orgId) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.testConnection();
  }

  async fetchProducts(orgId, options = {}) {
    const adapter = await this._adapterForOrg(orgId);
    const result = await adapter.fetchProducts(options);
    return {
      items: result.items.map(item => adapter.mapToInventoryItem(item)),
      rawItems: result.items,
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  async getProduct(orgId, productId) {
    const adapter = await this._adapterForOrg(orgId);
    const raw = await adapter.getProduct(productId);
    return { item: adapter.mapToInventoryItem(raw), raw };
  }

  async adjustInventory(orgId, posId, newQuantity, reason = 'StockFlow adjustment') {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.adjustInventory(posId, newQuantity, reason);
  }

  async createProduct(orgId, productData) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.createProduct(productData);
  }

  async updateProduct(orgId, posId, productData) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.updateProduct(posId, productData);
  }

  async deleteProduct(orgId, posId) {
    const adapter = await this._adapterForOrg(orgId);
    return adapter.deleteProduct(posId);
  }

  getProviders() {
    return listProviders().map(p => ({ id: p, name: p.charAt(0).toUpperCase() + p.slice(1) }));
  }
}

module.exports = new PosService();
