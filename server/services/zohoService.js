/**
 * Zoho Books Integration Service
 *
 * All config and token storage has been migrated from Firestore to Supabase.
 * Per-org Zoho data lives in organization_settings.zoho_config (JSONB).
 *
 * zoho_config shape:
 * {
 *   clientId, clientSecret, zohoOrgId, region, redirectUri,  ← set via /config endpoint
 *   access_token, refresh_token, expires_in, expires_at,     ← set via OAuth callback
 *   token_type, scope, userId,
 *   zoho_organization_id,                                    ← resolved numeric Zoho org ID
 *   updatedAt
 * }
 */

const axios   = require('axios');
const { supabase } = require('../supabaseAdmin');

const REGION_ACCOUNTS_DOMAIN = {
  us: 'https://accounts.zoho.com',
  eu: 'https://accounts.zoho.eu',
  in: 'https://accounts.zoho.in',
  au: 'https://accounts.zoho.com.au',
  jp: 'https://accounts.zoho.jp',
};

class ZohoService {
  constructor() {
    // Legacy single-tenant env vars — used only as fallbacks when per-org config is absent.
    this.clientId      = process.env.ZOHO_CLIENT_ID      || null;
    this.clientSecret  = process.env.ZOHO_CLIENT_SECRET  || null;
    this.redirectUri   = process.env.ZOHO_REDIRECT_URI   || null;
    this.refreshToken  = process.env.ZOHO_REFRESH_TOKEN  || null;
    this.organizationId = process.env.ZOHO_ORGANIZATION_ID || null;
    this.accountsUrl   = process.env.ZOHO_ACCOUNTS_URL   || 'https://accounts.zoho.com';
    this.booksApiUrl   = process.env.ZOHO_BOOKS_API_URL  || 'https://www.zohoapis.com/books/v3';

    this.accessToken      = null;
    this.tokenExpiryTime  = null;

    console.log('🔗 ZohoService initialized (Supabase-backed multi-tenant mode)');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _accountsUrlForRegion(region) {
    return REGION_ACCOUNTS_DOMAIN[region] || this.accountsUrl;
  }

  /**
   * Read the full zoho_config blob from organization_settings.
   * Returns null when the org has no row or the config is empty.
   */
  async _readZohoConfig(orgId) {
    try {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('zoho_config')
        .eq('org_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data?.zoho_config || null;
    } catch (err) {
      console.warn('⚠️ _readZohoConfig failed for org:', orgId, err.message);
      return null;
    }
  }

  /**
   * Merge partial updates into the existing zoho_config blob and upsert.
   */
  async _patchZohoConfig(orgId, patch) {
    // Read current config so we don't clobber unrelated fields
    const current = await this._readZohoConfig(orgId) || {};
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };

    const { error } = await supabase
      .from('organization_settings')
      .upsert({ org_id: orgId, zoho_config: updated }, { onConflict: 'org_id' });
    if (error) throw error;
    return updated;
  }

  // ── Public API (consumed by zoho.js routes) ──────────────────────────────────

  /**
   * Load per-org Zoho credentials (clientId, clientSecret, region, etc.)
   * Previously read from Firestore organizations/{orgId}/integrations/zoho_config
   */
  async getOrgConfig(orgId) {
    try {
      const cfg = await this._readZohoConfig(orgId);
      // Only return the config if it has the minimum required fields
      if (!cfg?.clientId) return null;
      return cfg;
    } catch (err) {
      console.warn('⚠️ Could not load Zoho config for org:', orgId, err.message);
      return null;
    }
  }

  /**
   * Exchange authorization code for OAuth tokens.
   */
  async exchangeCodeForTokens(authorizationCode, orgId) {
    try {
      console.log('🔄 Exchanging authorization code for tokens...');

      if (!orgId) return { success: false, error: 'Organization ID is required for token exchange' };

      const orgConfig = await this.getOrgConfig(orgId);
      if (!orgConfig?.clientId || !orgConfig?.clientSecret) {
        return {
          success: false,
          error: 'Zoho API credentials not configured for this organization. Please configure them in Integrations settings first.',
        };
      }

      const { clientId, clientSecret, region } = orgConfig;
      // Always use ZOHO_REDIRECT_URI env var — must exactly match what is
      // registered in Zoho API Console and what was sent in the auth URL.
      const redirectUri = process.env.ZOHO_REDIRECT_URI || orgConfig.redirectUri || this.redirectUri;
      const accountsUrl = this._accountsUrlForRegion(region);

      console.log('🔑 Token exchange params:', {
        orgId,
        clientId: clientId.substring(0, 12) + '...',
        region,
        accountsUrl,
        redirectUri,
        codeLength: authorizationCode?.length || 0,
      });

      if (!redirectUri) {
        return { success: false, error: 'Redirect URI not configured. Please set it in Zoho integration settings.' };
      }

      const response = await axios.post(`${accountsUrl}/oauth/v2/token`, null, {
        params: {
          code: authorizationCode,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      console.log('📥 Zoho token endpoint raw response:', JSON.stringify(response.data));

      if (response.data.error) {
        console.error('❌ Zoho token error in response body:', response.data.error);
        return { success: false, error: `Zoho error: ${response.data.error}` };
      }

      if (response.data.access_token) {
        return {
          success: true,
          tokens: {
            access_token:  response.data.access_token,
            refresh_token: response.data.refresh_token,
            expires_in:    response.data.expires_in,
            token_type:    response.data.token_type || 'Bearer',
            scope:         response.data.scope,
          },
        };
      }

      throw new Error('No access_token in Zoho response');
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      console.error('❌ Failed to exchange code for tokens:', err.response?.data || err.message);
      return { success: false, error: msg };
    }
  }

  /**
   * Store OAuth tokens for an org in Supabase organization_settings.zoho_config.
   * Previously wrote to Firestore organizations/{orgId}/integrations/zoho
   */
  async storeTokens(organizationId, userId, tokens) {
    try {
      console.log('💾 Storing Zoho tokens for org:', organizationId);
      await this._patchZohoConfig(organizationId, {
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in:    tokens.expires_in,
        expires_at:    Date.now() + (tokens.expires_in * 1000),
        token_type:    tokens.token_type || 'Bearer',
        scope:         tokens.scope,
        userId,
      });
      console.log('✅ Tokens stored in Supabase for org:', organizationId);
      return { success: true };
    } catch (err) {
      console.error('❌ Failed to store tokens:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Retrieve stored OAuth tokens for an org.
   * Previously read from Firestore organizations/{orgId}/integrations/zoho
   */
  async getStoredTokens(organizationId) {
    try {
      const cfg = await this._readZohoConfig(organizationId);
      if (!cfg?.access_token && !cfg?.refresh_token) {
        console.log('❌ No stored Zoho tokens for org:', organizationId);
        return null;
      }
      console.log('✅ Retrieved Zoho tokens for org:', organizationId);
      return cfg;
    } catch (err) {
      console.error('❌ Failed to retrieve stored tokens:', err);
      return null;
    }
  }

  /**
   * Return a valid access token for an org, refreshing if necessary.
   */
  async getAccessTokenForOrg(organizationId) {
    try {
      const tokenData = await this.getStoredTokens(organizationId);
      if (!tokenData) throw new Error(`No Zoho tokens found for organization: ${organizationId}`);

      const now = Date.now();

      // Token is fresh enough
      if (tokenData.expires_at && (tokenData.expires_at - now) > 5 * 60 * 1000) {
        return tokenData.access_token;
      }

      // No refresh token — use access token if still valid, otherwise force reauth
      if (!tokenData.refresh_token) {
        if (tokenData.access_token && tokenData.expires_at && tokenData.expires_at > now) {
          console.warn('⚠️ No refresh_token; using still-valid access token');
          return tokenData.access_token;
        }
        throw new Error('ZOHO_REAUTH_REQUIRED: No Zoho refresh token on file. Please reconnect Zoho Books in Integrations settings.');
      }

      // Refresh the token
      console.log('🔄 Refreshing access token for org:', organizationId);
      const orgConfig  = await this.getOrgConfig(organizationId);
      const clientId   = orgConfig?.clientId    || this.clientId;
      const clientSec  = orgConfig?.clientSecret || this.clientSecret;
      const acctUrl    = orgConfig ? this._accountsUrlForRegion(orgConfig.region) : this.accountsUrl;

      try {
        const response = await axios.post(`${acctUrl}/oauth/v2/token`, null, {
          params: {
            refresh_token: tokenData.refresh_token,
            client_id:     clientId,
            client_secret: clientSec,
            grant_type:    'refresh_token',
          },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        if (response.data.access_token) {
          const newExpiresAt = now + (response.data.expires_in * 1000);
          // Patch only the token fields — never overwrite refresh_token or config fields
          await this._patchZohoConfig(organizationId, {
            access_token: response.data.access_token,
            expires_in:   response.data.expires_in,
            expires_at:   newExpiresAt,
          });
          console.log('✅ Access token refreshed for org:', organizationId);
          return response.data.access_token;
        }

        const zohoError = response.data?.error || 'no access_token in refresh response';
        throw new Error(zohoError);

      } catch (refreshErr) {
        const zohoErr = refreshErr.response?.data?.error || refreshErr.message;
        // Fall back to current token if still valid
        if (tokenData.access_token && tokenData.expires_at && tokenData.expires_at > now) {
          console.warn(`⚠️ Token refresh failed (${zohoErr}); stored token still valid — using it`);
          return tokenData.access_token;
        }
        console.error(`❌ Token refresh failed and access token expired: ${zohoErr}`);
        throw new Error('ZOHO_REAUTH_REQUIRED: Could not refresh Zoho access token. Please reconnect Zoho Books in Integrations settings.');
      }
    } catch (err) {
      console.error('❌ getAccessTokenForOrg failed for org:', organizationId, err.message);
      throw err;
    }
  }

  /**
   * Legacy single-tenant access token (env-var based). Used only by non-org-scoped routes.
   */
  async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiryTime && (this.tokenExpiryTime - now) > 5 * 60 * 1000) {
      return this.accessToken;
    }
    const response = await axios.post(`${this.accountsUrl}/oauth/v2/token`, null, {
      params: {
        refresh_token: this.refreshToken,
        client_id:     this.clientId,
        client_secret: this.clientSecret,
        grant_type:    'refresh_token',
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (response.data.access_token) {
      this.accessToken     = response.data.access_token;
      this.tokenExpiryTime = now + (response.data.expires_in * 1000);
      return this.accessToken;
    }
    throw new Error('Failed to authenticate with Zoho Books');
  }

  /**
   * Get or resolve the numeric Zoho organization_id for a StockFlow org.
   * Caches the result in zoho_config.zoho_organization_id.
   */
  async getZohoOrgIdForOrg(organizationId) {
    try {
      const tokenData = await this.getStoredTokens(organizationId);
      if (!tokenData) throw new Error(`No Zoho tokens for org: ${organizationId}`);

      if (tokenData.zoho_organization_id) return tokenData.zoho_organization_id;

      // Resolve via Zoho API
      console.log('🔍 Resolving Zoho organization ID from /organizations API...');
      const accessToken = await this.getAccessTokenForOrg(organizationId);
      const response    = await axios.get(`${this.booksApiUrl}/organizations`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });

      const orgs = response.data.organizations || [];
      if (orgs.length === 0) throw new Error('No organizations returned from Zoho Books API');

      const zohoOrgId = String(orgs[0].organization_id);
      console.log(`✅ Zoho organization_id resolved: ${zohoOrgId} (${orgs[0].name})`);

      // Cache in Supabase
      await this._patchZohoConfig(organizationId, { zoho_organization_id: zohoOrgId });

      return zohoOrgId;
    } catch (err) {
      console.warn('⚠️ getZohoOrgIdForOrg failed, falling back to env var:', err.message);
      if (this.organizationId) return this.organizationId;
      throw err;
    }
  }

  // ── Zoho Books API wrappers ──────────────────────────────────────────────────

  async makeApiRequest(endpoint, method = 'GET', data = null) {
    const token  = await this.getAccessToken();
    const config = {
      method,
      url: `${this.booksApiUrl}${endpoint}`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      params: { organization_id: this.organizationId },
    };
    if (method === 'GET') { config.params = { ...config.params, ...(data || {}) }; }
    else if (data)         { config.data = data; }
    const response = await axios(config);
    return response.data;
  }

  async getItemsPage(organizationId, page = 1, perPage = 200) {
    const [accessToken, zohoOrgId] = await Promise.all([
      this.getAccessTokenForOrg(organizationId),
      this.getZohoOrgIdForOrg(organizationId),
    ]);
    const response = await axios.get(`${this.booksApiUrl}/items`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
      params:  { organization_id: zohoOrgId, page, per_page: perPage },
    });
    return { items: response.data.items || [], page_context: response.data.page_context || {} };
  }

  async getItems(organizationId) {
    console.log('📦 Fetching ALL items from Zoho Books for org:', organizationId);
    let allItems = [], currentPage = 1, totalPages = 1, totalItems = 0;

    do {
      const result = await this.getItemsPage(organizationId, currentPage, 200);
      allItems = allItems.concat(result.items);
      if (currentPage === 1) {
        if (result.page_context?.total) {
          totalPages  = Math.ceil(result.page_context.total / 200);
          totalItems  = result.page_context.total;
        } else if (result.items.length < 200) {
          totalPages = 1;
          totalItems = result.items.length;
        } else {
          totalPages = 999;
        }
      }
      if (!result.page_context?.total && result.items.length < 200) break;
      currentPage++;
      if (currentPage <= totalPages) await new Promise(r => setTimeout(r, 100));
    } while (currentPage <= totalPages);

    allItems.sort((a, b) => {
      const da = new Date(a.last_modified_time || a.created_time || 0);
      const db_ = new Date(b.last_modified_time || b.created_time || 0);
      if (db_ - da !== 0) return db_ - da;
      const sa = a.status === 'active' ? 0 : 1;
      const sb = b.status === 'active' ? 0 : 1;
      if (sb - sa !== 0) return sa - sb;
      return (a.name || '').localeCompare(b.name || '');
    });

    console.log(`✅ Fetched ${allItems.length} items from Zoho Books`);
    return { items: allItems, total_items: allItems.length, page_context: { total: allItems.length, per_page: allItems.length, page: 1, total_pages: 1 } };
  }

  async createItem(itemData) {
    const response = await this.makeApiRequest('/items', 'POST', itemData);
    return response.item;
  }

  async updateItem(itemId, itemData) {
    const response = await this.makeApiRequest(`/items/${itemId}`, 'PUT', itemData);
    return response.item;
  }

  async adjustStock(organizationId, zohoItemId, quantityAdjusted, reason, referenceNumber) {
    const [accessToken, zohoOrgId] = await Promise.all([
      this.getAccessTokenForOrg(organizationId),
      this.getZohoOrgIdForOrg(organizationId),
    ]);
    const payload = {
      reason:     reason || 'Stock adjustment via StockFlow',
      line_items: [{ item_id: zohoItemId, quantity_adjusted: quantityAdjusted }],
    };
    const response = await axios.post(`${this.booksApiUrl}/inventoryadjustments`, payload, {
      params:  { organization_id: zohoOrgId },
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
    });
    const adj = response.data.inventory_adjustment;
    console.log('✅ Inventory adjustment created:', adj?.inventory_adjustment_id);
    return adj;
  }

  async adjustStockBatch(organizationId, lineItems, reason, referenceNumber) {
    if (!lineItems?.length) throw new Error('adjustStockBatch called with empty line items');
    const [accessToken, zohoOrgId] = await Promise.all([
      this.getAccessTokenForOrg(organizationId),
      this.getZohoOrgIdForOrg(organizationId),
    ]);
    const payload = { reason: reason || 'Stock take adjustment via StockFlow', line_items: lineItems };
    const response = await axios.post(`${this.booksApiUrl}/inventoryadjustments`, payload, {
      params:  { organization_id: zohoOrgId },
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
    });
    const adj = response.data.inventory_adjustment;
    console.log(`✅ Batch adjustment created: ${adj?.inventory_adjustment_id} (${lineItems.length} items)`);
    return adj;
  }

  async buildSkuToItemIdMap(organizationId) {
    const [accessToken, zohoOrgId] = await Promise.all([
      this.getAccessTokenForOrg(organizationId),
      this.getZohoOrgIdForOrg(organizationId),
    ]);
    const skuMap = new Map();
    let page = 1, hasMore = true;
    while (hasMore) {
      const response = await axios.get(`${this.booksApiUrl}/items`, {
        params:  { organization_id: zohoOrgId, page, per_page: 200 },
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      (response.data.items || []).forEach(item => { if (item.sku) skuMap.set(item.sku, item.item_id); });
      hasMore = response.data.page_context?.has_more_page ?? false;
      page++;
    }
    console.log(`🗺️ Built SKU map: ${skuMap.size} items`);
    return skuMap;
  }

  async fetchStockOnHand(organizationId, skus = []) {
    const [accessToken, zohoOrgId] = await Promise.all([
      this.getAccessTokenForOrg(organizationId),
      this.getZohoOrgIdForOrg(organizationId),
    ]);
    const skuSet = new Set(skus.map(s => s.trim().toLowerCase()));
    const result = new Map();
    let page = 1, hasMore = true;
    while (hasMore) {
      const response = await axios.get(`${this.booksApiUrl}/items`, {
        params:  { organization_id: zohoOrgId, page, per_page: 200 },
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      for (const item of (response.data.items || [])) {
        if (!item.sku) continue;
        if (skuSet.size > 0 && !skuSet.has(item.sku.trim().toLowerCase())) continue;
        result.set(item.sku, { stock_on_hand: item.stock_on_hand ?? 0, item_id: item.item_id, item_name: item.name });
      }
      hasMore = response.data.page_context?.has_more_page ?? false;
      page++;
    }
    console.log(`📥 Fetched stock_on_hand for ${result.size} items`);
    return result;
  }

  async findItemBySku(organizationId, sku) {
    try {
      const [accessToken, zohoOrgId] = await Promise.all([
        this.getAccessTokenForOrg(organizationId),
        this.getZohoOrgIdForOrg(organizationId),
      ]);
      const response = await axios.get(`${this.booksApiUrl}/items`, {
        params:  { organization_id: zohoOrgId, sku },
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      return (response.data.items || []).find(i => i.sku === sku) || null;
    } catch (err) {
      const zohoErr = err.response?.data;
      const msg     = zohoErr?.message || err.message;
      if (zohoErr?.code === 57 || msg?.toLowerCase().includes('not authorized')) {
        throw new Error('ZOHO_TOKEN_EXPIRED: Access token is expired or invalid. Please re-authenticate with Zoho Books in Integrations settings.');
      }
      console.error('❌ findItemBySku failed:', zohoErr || err.message);
      return null;
    }
  }

  async getOrganization() {
    const response = await this.makeApiRequest('/organizations');
    return response.organizations || [];
  }

  async getOrganizationInfo() { return this.getOrganization(); }

  async testConnection() {
    try {
      const organizations = await this.getOrganization();
      if (organizations?.length > 0) {
        const org = organizations[0];
        return { success: true, message: 'Connected to Zoho Books successfully', organizationId: org.organization_id, organizationName: org.name };
      }
      throw new Error('No organizations found');
    } catch (err) {
      return { success: false, message: 'Failed to connect to Zoho Books', error: err.response?.data?.message || err.message };
    }
  }

  async bulkSyncItems(items) {
    const results = [];
    for (const item of items) {
      try {
        const result = item.zohoItemId ? await this.updateItem(item.zohoItemId, item) : await this.createItem(item);
        results.push({ success: true, item: result });
      } catch (err) {
        results.push({ success: false, item: item.name, error: err.message });
      }
    }
    return results;
  }

  /**
   * syncInvoiceUsage — still uses Supabase inventory_items (not Firestore).
   * Now updates inventory_items directly instead of Firestore.
   */
  async syncInvoiceUsage(organizationId) {
    const accessToken = await this.getAccessTokenForOrg(organizationId);
    let page = 1, totalInvoices = 0;
    const itemLastInvoiced = {};

    while (true) {
      const response = await axios.get(`${this.booksApiUrl}/invoices`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'Content-Type': 'application/json' },
        params:  { organization_id: this.organizationId, page, per_page: 200, sort_column: 'date', sort_order: 'D' },
      });
      const invoices = response.data.invoices || [];
      if (invoices.length === 0) break;
      totalInvoices += invoices.length;
      for (const invoice of invoices) {
        const invoiceDate   = new Date(invoice.date);
        const invoiceNumber = invoice.invoice_number;
        for (const lineItem of invoice.line_items || []) {
          const itemId = lineItem.item_id;
          if (!itemId) continue;
          if (!itemLastInvoiced[itemId] || invoiceDate > new Date(itemLastInvoiced[itemId].date)) {
            itemLastInvoiced[itemId] = { date: invoiceDate.toISOString(), invoiceNumber, quantity: lineItem.quantity || 0 };
          }
        }
      }
      if (!response.data.page_context?.has_more_page) break;
      page++;
      await new Promise(r => setTimeout(r, 100));
    }

    // Update inventory_items in Supabase by matching a zoho_item_id stored in metadata
    // (best-effort — items without a zoho_item_id link are skipped)
    let updateCount = 0;
    for (const [zohoItemId, usageData] of Object.entries(itemLastInvoiced)) {
      try {
        const { error } = await supabase
          .from('inventory_items')
          .update({ updated_at: new Date().toISOString() }) // placeholder — extend schema if lastUsed is needed
          .eq('org_id', organizationId)
          .contains('description', zohoItemId); // approximate match
        if (!error) updateCount++;
      } catch (_) { /* skip */ }
    }

    return { itemsUpdated: updateCount, invoicesProcessed: totalInvoices };
  }
}

module.exports = new ZohoService();
