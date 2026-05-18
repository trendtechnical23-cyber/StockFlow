/**
 * Zoho Books Integration Service
 * Handles authentication, token management, and API operations with Zoho Books
 */

const axios = require('axios');
const admin = require('firebase-admin');

class ZohoService {
    constructor() {
        // Legacy env-var credentials kept ONLY for backward-compat admin/test use.
        // Production multi-tenant flow always loads per-org config from Firestore.
        this.clientId = process.env.ZOHO_CLIENT_ID || null;
        this.clientSecret = process.env.ZOHO_CLIENT_SECRET || null;
        this.redirectUri = process.env.ZOHO_REDIRECT_URI || null;
        this.refreshToken = process.env.ZOHO_REFRESH_TOKEN || null;
        this.organizationId = process.env.ZOHO_ORGANIZATION_ID || null;
        this.accountsUrl = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com';
        this.booksApiUrl = process.env.ZOHO_BOOKS_API_URL || 'https://www.zohoapis.com/books/v3';
        
        this.accessToken = null;
        this.tokenExpiryTime = null;
        
        console.log('🔗 ZohoService initialized (multi-tenant mode — per-org credentials from Firestore)');
    }

    /**
     * Load per-org Zoho config from Firestore (Client ID, Secret, region, Zoho Org ID)
     */
    async getOrgConfig(orgId) {
        try {
            const db = admin.firestore();
            const doc = await db.collection('organizations').doc(orgId).collection('integrations').doc('zoho_config').get();
            return doc.exists ? doc.data() : null;
        } catch (error) {
            console.warn('⚠️ Could not load Zoho config for org:', orgId, error.message);
            return null;
        }
    }

    /**
     * Resolve accounts URL from region string
     */
    _accountsUrlForRegion(region) {
        const map = { us: 'https://accounts.zoho.com', eu: 'https://accounts.zoho.eu', in: 'https://accounts.zoho.in', au: 'https://accounts.zoho.com.au', jp: 'https://accounts.zoho.jp' };
        return map[region] || this.accountsUrl;
    }

    /**
     * Exchange authorization code for tokens — uses per-org credentials when orgId is provided
     */
    async exchangeCodeForTokens(authorizationCode, orgId) {
        try {
            console.log('🔄 Exchanging authorization code for tokens...');

            if (!orgId) {
                return { success: false, error: 'Organization ID is required for token exchange' };
            }

            // Load per-org credentials from Firestore (multi-tenant — no env-var fallback)
            const orgConfig = await this.getOrgConfig(orgId);
            if (!orgConfig || !orgConfig.clientId || !orgConfig.clientSecret) {
                return {
                    success: false,
                    error: 'Zoho API credentials not configured for this organization. Please configure them in Integrations settings first.'
                };
            }

            const clientId = orgConfig.clientId;
            const clientSecret = orgConfig.clientSecret;
            const redirectUri = orgConfig.redirectUri || this.redirectUri;
            const accountsUrl = this._accountsUrlForRegion(orgConfig.region);

            console.log('🔑 Token exchange params:', {
                orgId,
                clientId: clientId.substring(0, 12) + '...',
                region: orgConfig.region,
                accountsUrl,
                redirectUri,
                codeLength: authorizationCode?.length || 0
            });

            if (!redirectUri) {
                return {
                    success: false,
                    error: 'Redirect URI not configured. Please set it in Zoho integration settings.'
                };
            }
            
            const response = await axios.post(`${accountsUrl}/oauth/v2/token`, null, {
                params: {
                    code: authorizationCode,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            console.log('📥 Zoho token endpoint raw response:', JSON.stringify(response.data));

            if (response.data.error) {
                // Zoho returned 200 but with an error field (e.g. invalid_code)
                console.error('❌ Zoho token error in response body:', response.data.error);
                return {
                    success: false,
                    error: `Zoho error: ${response.data.error}`
                };
            }

            if (response.data.access_token) {
                const tokens = {
                    access_token: response.data.access_token,
                    refresh_token: response.data.refresh_token,
                    expires_in: response.data.expires_in,
                    token_type: response.data.token_type || 'Bearer',
                    scope: response.data.scope
                };

                console.log('✅ Token exchange successful');
                return {
                    success: true,
                    tokens
                };
            } else {
                throw new Error('No access token in Zoho response');
            }
        } catch (error) {
            const zohoErrorData = error.response?.data;
            const zohoErrorMsg = zohoErrorData?.error || error.message;
            console.error('❌ Failed to exchange code for tokens:', zohoErrorData || error.message);
            return {
                success: false,
                error: zohoErrorMsg
            };
        }
    }

    /**
     * Store tokens for organization in Firestore
     */
    async storeTokens(organizationId, userId, tokens) {
        try {
            console.log('💾 Storing tokens for organization:', organizationId);
            console.log('👤 User ID:', userId);
            console.log('🔑 Token data received:', {
                hasAccessToken: !!tokens.access_token,
                hasRefreshToken: !!tokens.refresh_token,
                tokenType: tokens.token_type
            });
            
            const db = admin.firestore();
            
            // Test Firestore connectivity
            console.log('🔥 Testing Firestore connectivity...');
            try {
                const testRef = db.collection('_test').doc('connectivity');
                await testRef.set({ timestamp: new Date(), test: 'zoho-token-storage' });
                console.log('✅ Firestore is accessible');
                await testRef.delete(); // Clean up test document
            } catch (firestoreError) {
                console.error('❌ Firestore connectivity test failed:', firestoreError);
                throw new Error('Firestore not accessible: ' + firestoreError.message);
            }
            
            const tokenData = {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_in: tokens.expires_in,
                expires_at: Date.now() + (tokens.expires_in * 1000),
                token_type: tokens.token_type || 'Bearer',
                scope: tokens.scope,
                userId: userId,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            
            console.log('📄 Prepared token data:', Object.keys(tokenData));
            
            // Remove undefined values before writing to Firestore (Firestore doesn't allow undefined values)
            const cleanTokenData = Object.fromEntries(
                Object.entries(tokenData).filter(([_, v]) => v !== undefined)
            );
            
            console.log('🧹 Cleaned token data (removed undefined values):', Object.keys(cleanTokenData));
            
            // Store in Firestore under organizations/{orgId}/integrations/zoho
            const storePath = 'organizations/' + organizationId + '/integrations/zoho';
            console.log('💾 Storing tokens at path:', storePath);
            
            await db.collection('organizations')
                .doc(organizationId)
                .collection('integrations')
                .doc('zoho')
                .set(cleanTokenData, { merge: true });
            
            console.log('✅ Tokens stored successfully in Firestore at:', storePath);
            
            // Verify storage immediately
            const verifyDoc = await db.collection('organizations')
                .doc(organizationId)
                .collection('integrations')
                .doc('zoho')
                .get();
            
            if (verifyDoc.exists) {
                console.log('✅ Verification: Tokens immediately readable after storage');
            } else {
                console.log('❌ Verification: Tokens NOT immediately readable - possible Firestore lag');
            }
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to store tokens:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Retrieve tokens for organization from Firestore
     */
    async getStoredTokens(organizationId) {
        try {
            console.log('🔍 Looking for tokens at path: organizations/' + organizationId + '/integrations/zoho');
            const db = admin.firestore();
            const tokenDoc = await db.collection('organizations')
                .doc(organizationId)
                .collection('integrations')
                .doc('zoho')
                .get();
            
            if (!tokenDoc.exists) {
                console.log('❌ No stored tokens found for organization:', organizationId);
                console.log('🔍 Debug: Checking if organization document exists...');
                
                // Check if organization document exists
                const orgDoc = await db.collection('organizations').doc(organizationId).get();
                if (!orgDoc.exists) {
                    console.log('❌ Organization document does not exist:', organizationId);
                } else {
                    console.log('✅ Organization document exists');
                    
                    // Check integrations subcollection
                    const integrationsSnapshot = await db.collection('organizations').doc(organizationId).collection('integrations').get();
                    console.log('🔍 Integrations subcollection size:', integrationsSnapshot.size);
                    integrationsSnapshot.forEach(doc => {
                        console.log('📄 Integration document:', doc.id, '- exists:', doc.exists);
                    });
                }
                return null;
            }
            
            const tokenData = tokenDoc.data();
            console.log('✅ Retrieved stored tokens for organization:', organizationId);
            return tokenData;
        } catch (error) {
            console.error('❌ Failed to retrieve stored tokens:', error);
            return null;
        }
    }

    /**
     * Get valid access token for organization (refresh if needed)
     */
    async getAccessTokenForOrg(organizationId) {
        try {
            // Get stored tokens for this organization
            const tokenData = await this.getStoredTokens(organizationId);
            
            if (!tokenData) {
                throw new Error(`No Zoho tokens found for organization: ${organizationId}`);
            }
            
            const now = Date.now();
            
            // If token expires in more than 5 minutes, use it
            if (tokenData.expires_at && (tokenData.expires_at - now) > (5 * 60 * 1000)) {
                return tokenData.access_token;
            }
            
            // Refresh the token — use per-org credentials if available
            console.log('🔄 Refreshing access token for organization:', organizationId);

            const orgConfig = await this.getOrgConfig(organizationId);
            const refreshClientId = orgConfig?.clientId || this.clientId;
            const refreshClientSecret = orgConfig?.clientSecret || this.clientSecret;
            const refreshAccountsUrl = orgConfig ? this._accountsUrlForRegion(orgConfig.region) : this.accountsUrl;
            
            try {
                const response = await axios.post(`${refreshAccountsUrl}/oauth/v2/token`, null, {
                    params: {
                        refresh_token: tokenData.refresh_token,
                        client_id: refreshClientId,
                        client_secret: refreshClientSecret,
                        grant_type: 'refresh_token'
                    },
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });

                if (response.data.access_token) {
                    const updatedTokens = {
                        ...tokenData,
                        access_token: response.data.access_token,
                        expires_in: response.data.expires_in,
                        expires_at: now + (response.data.expires_in * 1000),
                        updatedAt: new Date()
                    };
                    const db = admin.firestore();
                    await db.collection('organizations')
                        .doc(organizationId)
                        .collection('integrations')
                        .doc('zoho')
                        .update(updatedTokens);
                    console.log('✅ Access token refreshed and stored for organization:', organizationId);
                    return response.data.access_token;
                }

                // Zoho responded but without an access_token (e.g. invalid_client error in body)
                const zohoError = response.data?.error || 'no access_token in refresh response';
                throw new Error(zohoError);

            } catch (refreshError) {
                // Refresh failed — if we still have a stored access_token use it as a fallback.
                // This handles cases where ZOHO_CLIENT_ID/SECRET are not configured on the
                // backend yet, or Zoho returns an unexpected response, while the stored token
                // is still valid (Zoho tokens live for 1 hour; we try to refresh at 5 min to
                // expiry, so we often have headroom).
                if (tokenData.access_token) {
                    console.warn(`⚠️  Token refresh failed (${refreshError.message}), falling back to stored access token`);
                    return tokenData.access_token;
                }
                throw refreshError;
            }
        } catch (error) {
            console.error('❌ Failed to get access token for organization:', organizationId, error.message);
            throw error;
        }
    }

    /**
     * Get valid access token (refresh if needed)
     */
    async getAccessToken() {
        const now = Date.now();
        
        // If we have a valid token that expires more than 5 minutes from now, use it
        if (this.accessToken && this.tokenExpiryTime && (this.tokenExpiryTime - now) > (5 * 60 * 1000)) {
            return this.accessToken;
        }

        // Refresh the token
        try {
            console.log('🔄 Refreshing Zoho access token...');
            
            const response = await axios.post(`${this.accountsUrl}/oauth/v2/token`, null, {
                params: {
                    refresh_token: this.refreshToken,
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    grant_type: 'refresh_token'
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                // Set expiry time (expires_in is in seconds)
                this.tokenExpiryTime = now + (response.data.expires_in * 1000);
                
                console.log('✅ Zoho access token refreshed successfully');
                return this.accessToken;
            } else {
                throw new Error('No access token in response');
            }
        } catch (error) {
            console.error('❌ Failed to refresh Zoho token:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Zoho Books');
        }
    }

    /**
     * Make authenticated API request to Zoho Books
     */
    async makeApiRequest(endpoint, method = 'GET', data = null) {
        try {
            const token = await this.getAccessToken();
            
            const config = {
                method,
                url: `${this.booksApiUrl}${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            };

            // Add organization ID to params
            const params = { organization_id: this.organizationId };
            
            if (method === 'GET') {
                config.params = { ...params, ...(data || {}) };
            } else {
                config.params = params;
                if (data) config.data = data;
            }

            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error(`❌ Zoho API request failed [${method} ${endpoint}]:`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get single page of items from Zoho Books
     */
    async getItemsPage(organizationId, page = 1, perPage = 200) {
        try {
            const accessToken = await this.getAccessTokenForOrg(organizationId);
            
            const config = {
                method: 'GET',
                url: `${this.booksApiUrl}/items`,
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    organization_id: this.organizationId,
                    page: page,
                    per_page: perPage
                }
            };

            const response = await axios(config);
            
            // Debug the response structure
            console.log('🔍 Zoho API Response structure:', {
                hasItems: !!response.data.items,
                itemsCount: response.data.items?.length || 0,
                hasPageContext: !!response.data.page_context,
                pageContext: response.data.page_context,
                allKeys: Object.keys(response.data)
            });
            
            return {
                items: response.data.items || [],
                page_context: response.data.page_context || {}
            };
        } catch (error) {
            console.error('❌ Failed to get items page from Zoho:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get ALL items from Zoho Books for specific organization (auto-paginate)
     */
    async getItems(organizationId) {
        try {
            console.log('� Fetching ALL items from Zoho Books for org:', organizationId);
            
            let allItems = [];
            let currentPage = 1;
            let totalPages = 1;
            let totalItems = 0;
            
            do {
                console.log(`📄 Fetching page ${currentPage} of ${totalPages}...`);
                
                const result = await this.getItemsPage(organizationId, currentPage, 200);
                
                // Add items from this page
                allItems = allItems.concat(result.items);
                
                // Update pagination info from first page
                if (currentPage === 1) {
                    if (result.page_context && result.page_context.total) {
                        totalPages = Math.ceil(result.page_context.total / 200);
                        totalItems = result.page_context.total;
                        console.log(`📊 Total items to fetch: ${totalItems} across ${totalPages} pages`);
                    } else {
                        // If no page_context, check if we got fewer items than requested
                        if (result.items.length < 200) {
                            totalPages = 1; // This is the last page
                            totalItems = result.items.length;
                            console.log(`📊 No pagination info found. Got ${result.items.length} items (less than 200), assuming single page.`);
                        } else {
                            // We got 200 items but no pagination info, assume there might be more
                            totalPages = 999; // Will keep fetching until we get < 200 items
                            console.log(`📊 No pagination info found. Got 200 items, will keep fetching until fewer items returned.`);
                        }
                    }
                }
                
                // If we don't have proper pagination info, stop when we get fewer items than requested
                if (!result.page_context?.total && result.items.length < 200) {
                    console.log(`📄 Got ${result.items.length} items (less than 200), assuming this is the last page.`);
                    break;
                }
                
                currentPage++;
                
                // Small delay to avoid rate limiting
                if (currentPage <= totalPages) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
                }
                
            } while (currentPage <= totalPages);
            
            console.log(`✅ Successfully fetched ALL ${allItems.length} items from Zoho Books`);
            
            // Debug: Log first item's available fields to understand what data we have
            if (allItems.length > 0) {
                console.log('🔍 Sample item fields:', Object.keys(allItems[0]));
                console.log('🔍 Sample item data:', {
                    name: allItems[0].name,
                    sku: allItems[0].sku,
                    last_modified_time: allItems[0].last_modified_time,
                    created_time: allItems[0].created_time,
                    status: allItems[0].status,
                    // Look for any usage/sales related fields
                    rate: allItems[0].rate,
                    quantity_on_hand: allItems[0].quantity_on_hand,
                    available_stock: allItems[0].available_stock
                });
            }
            
            // Sort by multiple criteria for better ordering (most recently used items first)
            allItems.sort((a, b) => {
                // Primary sort: last_modified_time (most recent first)
                const dateA = new Date(a.last_modified_time || a.created_time || 0);
                const dateB = new Date(b.last_modified_time || b.created_time || 0);
                const dateComparison = dateB - dateA; // Descending order
                
                if (dateComparison !== 0) {
                    return dateComparison;
                }
                
                // Secondary sort: by status (active items first)
                const statusA = a.status === 'active' ? 0 : 1;
                const statusB = b.status === 'active' ? 0 : 1;
                const statusComparison = statusA - statusB;
                
                if (statusComparison !== 0) {
                    return statusComparison;
                }
                
                // Tertiary sort: by name (alphabetical)
                return (a.name || '').localeCompare(b.name || '');
            });
            
            console.log(`🔄 Items sorted by: 1) Last modified (recent first), 2) Status (active first), 3) Name (A-Z)`);
            
            return {
                items: allItems,
                total_items: allItems.length,
                page_context: {
                    total: allItems.length,
                    per_page: allItems.length,
                    page: 1,
                    total_pages: 1
                }
            };
        } catch (error) {
            console.error('❌ Failed to get all items from Zoho:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Create new item in Zoho Books
     */
    async createItem(itemData) {
        try {
            console.log('🆕 Creating item in Zoho Books:', itemData.name);
            
            const response = await this.makeApiRequest('/items', 'POST', itemData);
            
            console.log('✅ Item created in Zoho Books:', response.item?.item_id);
            return response.item;
        } catch (error) {
            console.error('❌ Failed to create item in Zoho:', error);
            throw error;
        }
    }

    /**
     * Update item in Zoho Books
     */
    async updateItem(itemId, itemData) {
        try {
            console.log('📝 Updating item in Zoho Books:', itemId);
            
            const response = await this.makeApiRequest(`/items/${itemId}`, 'PUT', itemData);
            
            console.log('✅ Item updated in Zoho Books:', itemId);
            return response.item;
        } catch (error) {
            console.error('❌ Failed to update item in Zoho:', error);
            throw error;
        }
    }

    /**
     * Get the Zoho Books numeric organization_id for a StockFlow org.
     * Reads from the cached value in Firestore (zoho_organization_id field).
     * If not cached yet, fetches from Zoho's /organizations endpoint and stores it.
     * Falls back to the ZOHO_ORGANIZATION_ID env var if both sources fail.
     */
    async getZohoOrgIdForOrg(organizationId) {
        try {
            const tokenData = await this.getStoredTokens(organizationId);
            if (!tokenData) throw new Error(`No Zoho tokens for org: ${organizationId}`);

            // Return cached value
            if (tokenData.zoho_organization_id) {
                return tokenData.zoho_organization_id;
            }

            // Fetch from Zoho Books API
            console.log('🔍 Fetching Zoho organization ID from /organizations API...');
            const accessToken = tokenData.access_token;
            const response = await axios.get(`${this.booksApiUrl}/organizations`, {
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });

            const orgs = response.data.organizations || [];
            if (orgs.length === 0) throw new Error('No organizations returned from Zoho Books API');

            const zohoOrgId = String(orgs[0].organization_id);
            console.log(`✅ Zoho organization_id resolved: ${zohoOrgId} (${orgs[0].name})`);

            // Cache it in Firestore so we don't hit /organizations on every call
            const db = admin.firestore();
            await db.collection('organizations').doc(organizationId)
                .collection('integrations').doc('zoho')
                .update({ zoho_organization_id: zohoOrgId });

            return zohoOrgId;
        } catch (error) {
            console.warn('⚠️  getZohoOrgIdForOrg failed, falling back to env var:', error.message);
            // Fall back to the single-tenant env var
            if (this.organizationId) return this.organizationId;
            throw error;
        }
    }

    /**
     * Create an inventory adjustment in Zoho Books
     * @param {string} organizationId  - StockFlow org ID (used to fetch per-org OAuth tokens)
     * @param {string} zohoItemId      - Zoho Books item_id for the item being adjusted
     * @param {number} quantityAdjusted - signed delta (positive = add stock, negative = remove)
     * @param {string} reason          - human-readable reason shown in Zoho Books
     * @param {string} [referenceNumber] - optional reference number
     */
    async adjustStock(organizationId, zohoItemId, quantityAdjusted, reason, referenceNumber) {
        try {
            console.log(`📊 Creating inventory adjustment in Zoho Books | orgId: ${organizationId} | itemId: ${zohoItemId} | qty: ${quantityAdjusted}`);

            const [accessToken, zohoOrgId] = await Promise.all([
                this.getAccessTokenForOrg(organizationId),
                this.getZohoOrgIdForOrg(organizationId)
            ]);

            // Keep the Zoho payload strictly minimal — only fields Zoho needs.
            // No local workflow fields, no fake statuses, no reference numbers that
            // could be regenerated differently on a retry and cause a mismatch.
            const payload = {
                reason: reason || 'Stock adjustment via StockFlow',
                line_items: [{
                    item_id: zohoItemId,
                    quantity_adjusted: quantityAdjusted
                }]
            };

            console.log('📤 Zoho adjustment payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.booksApiUrl}/inventoryadjustments`,
                payload,
                {
                    params: { organization_id: zohoOrgId },
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const adj = response.data.inventory_adjustment;
            console.log('✅ Inventory adjustment created in Zoho Books:', adj?.inventory_adjustment_id);
            return adj;
        } catch (error) {
            const zohoError = error.response?.data;
            console.error('❌ Failed to create inventory adjustment in Zoho:', zohoError || error.message);
            throw new Error(zohoError?.message || error.message);
        }
    }

    /**
     * Create a single multi-line inventory adjustment for an entire stock take session.
     * All items are combined into one Zoho Books transaction — cleaner ledger, far fewer API calls.
     *
     * @param {string} organizationId
     * @param {Array<{item_id: string, quantity_adjusted: number}>} lineItems
     * @param {string} reason
     * @param {string} referenceNumber
     */
    async adjustStockBatch(organizationId, lineItems, reason, referenceNumber) {
        try {
            if (!lineItems || lineItems.length === 0) {
                throw new Error('adjustStockBatch called with empty line items');
            }

            console.log(`📊 Creating BATCH inventory adjustment | org: ${organizationId} | items: ${lineItems.length}`);

            const [accessToken, zohoOrgId] = await Promise.all([
                this.getAccessTokenForOrg(organizationId),
                this.getZohoOrgIdForOrg(organizationId)
            ]);

            // Keep the Zoho payload strictly minimal — only fields Zoho needs.
            const payload = {
                reason: reason || 'Stock take adjustment via StockFlow',
                line_items: lineItems
            };

            console.log(`📤 Batch adjustment payload: ${lineItems.length} line items`);

            const response = await axios.post(
                `${this.booksApiUrl}/inventoryadjustments`,
                payload,
                {
                    params: { organization_id: zohoOrgId },
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const adj = response.data.inventory_adjustment;
            console.log(`✅ Batch adjustment created in Zoho Books: ${adj?.inventory_adjustment_id} (${lineItems.length} items)`);
            return adj;
        } catch (error) {
            const zohoError = error.response?.data;
            console.error('❌ Failed to create batch inventory adjustment:', zohoError || error.message);
            throw new Error(zohoError?.message || error.message);
        }
    }

    /**
     * Fetch ALL items for an org and return a Map<sku, zoho_item_id>.
     * Used by the batch-session route to resolve SKUs without per-item API calls.
     */
    async buildSkuToItemIdMap(organizationId) {
        const [accessToken, zohoOrgId] = await Promise.all([
            this.getAccessTokenForOrg(organizationId),
            this.getZohoOrgIdForOrg(organizationId)
        ]);

        const skuMap = new Map();
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const response = await axios.get(`${this.booksApiUrl}/items`, {
                params: { organization_id: zohoOrgId, page, per_page: 200 },
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });

            const items = response.data.items || [];
            items.forEach(item => {
                if (item.sku) skuMap.set(item.sku, item.item_id);
            });

            const pageCtx = response.data.page_context;
            hasMore = pageCtx ? pageCtx.has_more_page : false;
            page++;
        }

        console.log(`🗺️ Built SKU map: ${skuMap.size} items`);
        return skuMap;
    }

    /**
     * Fetch current stock_on_hand for a list of SKUs from Zoho Books.
     * Returns Map<sku, stock_on_hand>. Used to pull quantities into the
     * dashboard AFTER a draft adjustment has been approved in Zoho Books.
     * This is the ONLY way local stock should ever be updated when Zoho is connected.
     *
     * @param {string} organizationId
     * @param {string[]} skus  - list of SKUs to fetch (empty = fetch ALL)
     */
    async fetchStockOnHand(organizationId, skus = []) {
        const [accessToken, zohoOrgId] = await Promise.all([
            this.getAccessTokenForOrg(organizationId),
            this.getZohoOrgIdForOrg(organizationId)
        ]);

        const skuSet = new Set(skus.map(s => s.trim().toLowerCase()));
        const result = new Map(); // Map<sku, { stock_on_hand, item_id, item_name }>
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const response = await axios.get(`${this.booksApiUrl}/items`, {
                params: { organization_id: zohoOrgId, page, per_page: 200 },
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });

            const items = response.data.items || [];
            for (const item of items) {
                if (!item.sku) continue;
                if (skuSet.size > 0 && !skuSet.has(item.sku.trim().toLowerCase())) continue;
                result.set(item.sku, {
                    stock_on_hand: item.stock_on_hand ?? 0,
                    item_id: item.item_id,
                    item_name: item.name
                });
            }

            const pageCtx = response.data.page_context;
            hasMore = pageCtx ? pageCtx.has_more_page : false;
            page++;
        }

        console.log(`📥 Fetched stock_on_hand for ${result.size} items from Zoho Books`);
        return result;
    }

    /**
     * Find a Zoho Books item by SKU
     */
    async findItemBySku(organizationId, sku) {
        try {
            const [accessToken, zohoOrgId] = await Promise.all([
                this.getAccessTokenForOrg(organizationId),
                this.getZohoOrgIdForOrg(organizationId)
            ]);
            console.log(`🔍 findItemBySku | zohoOrgId: ${zohoOrgId} | sku: ${sku}`);
            const response = await axios.get(`${this.booksApiUrl}/items`, {
                params: { organization_id: zohoOrgId, sku },
                headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
            });
            return (response.data.items || []).find(i => i.sku === sku) || null;
        } catch (error) {
            const zohoErr = error.response?.data;
            const msg = zohoErr?.message || error.message;
            const code = zohoErr?.code;
            // Code 57 = expired/invalid token. Surface this clearly so the route can
            // return a useful error rather than a generic 404.
            if (code === 57 || msg?.toLowerCase().includes('not authorized')) {
                throw new Error('ZOHO_TOKEN_EXPIRED: Access token is expired or invalid. Please re-authenticate with Zoho Books in Integrations settings.');
            }
            console.error('❌ findItemBySku failed:', zohoErr || error.message);
            return null;
        }
    }

    /**
     * Bulk sync items to Zoho Books
     */
    async bulkSyncItems(items) {
        try {
            console.log('🔄 Bulk syncing items to Zoho Books:', items.length);
            
            const results = [];
            
            for (const item of items) {
                try {
                    // Try to create the item
                    const result = await this.createItem(item);
                    results.push({ success: true, item: result });
                } catch (error) {
                    console.warn(`⚠️ Failed to sync item ${item.name}:`, error.message);
                    results.push({ success: false, item: item.name, error: error.message });
                }
            }
            
            console.log('✅ Bulk sync completed:', {
                total: items.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length
            });
            
            return results;
        } catch (error) {
            console.error('❌ Failed to bulk sync items:', error);
            throw error;
        }
    }

    /**
     * Get organization info from Zoho Books
     */
    async getOrganization() {
        try {
            console.log('🏢 Fetching organization info from Zoho...');
            
            const response = await this.makeApiRequest('/organizations');
            
            console.log('✅ Organization info retrieved from Zoho Books');
            return response.organizations || [];
        } catch (error) {
            console.error('❌ Failed to get organization info from Zoho:', error);
            throw error;
        }
    }

    /**
     * Sync invoice usage data - fetch invoices and update lastInvoicedAt for items
     * This tracks actual sales/usage, not just stock modifications
     */
    async syncInvoiceUsage(organizationId) {
        try {
            console.log(`🧾 Fetching invoices to track item usage for org: ${organizationId}...`);
            
            const accessToken = await this.getAccessTokenForOrg(organizationId);
            const db = admin.firestore();
            
            let page = 1;
            let totalInvoices = 0;
            const itemLastInvoiced = {}; // item_id -> { date, invoiceNumber, quantity }
            
            // Fetch invoices (paginated)
            while (true) {
                console.log(`📄 Fetching invoices page ${page}...`);
                
                const response = await axios.get(
                    `${this.booksApiUrl}/invoices`,
                    {
                        headers: {
                            'Authorization': `Zoho-oauthtoken ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        params: {
                            organization_id: this.organizationId,
                            page: page,
                            per_page: 200,
                            sort_column: 'date',
                            sort_order: 'D' // Descending - newest first
                        }
                    }
                );
                
                const invoices = response.data.invoices || [];
                if (invoices.length === 0) break;
                
                totalInvoices += invoices.length;
                console.log(`📊 Processing ${invoices.length} invoices from page ${page}...`);
                
                // Process each invoice and extract item usage
                for (const invoice of invoices) {
                    const invoiceDate = new Date(invoice.date);
                    const invoiceNumber = invoice.invoice_number;
                    
                    // Process line items in this invoice
                    for (const lineItem of invoice.line_items || []) {
                        const itemId = lineItem.item_id;
                        
                        if (!itemId) continue; // Skip non-item lines (like descriptions)
                        
                        // Track the most recent invoice date for this item
                        if (!itemLastInvoiced[itemId] || 
                            invoiceDate > new Date(itemLastInvoiced[itemId].date)) {
                            itemLastInvoiced[itemId] = {
                                date: invoiceDate.toISOString(),
                                invoiceNumber: invoiceNumber,
                                quantity: lineItem.quantity || 0
                            };
                        }
                    }
                }
                
                // Check if there are more pages
                if (!response.data.page_context?.has_more_page) {
                    console.log(`✅ Reached last page (page ${page})`);
                    break;
                }
                
                page++;
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log(`📊 Processed ${totalInvoices} invoices, found usage for ${Object.keys(itemLastInvoiced).length} items`);
            
            // Update Firestore with lastInvoicedAt timestamps
            const batch = db.batch();
            let updateCount = 0;
            
            for (const [zohoItemId, usageData] of Object.entries(itemLastInvoiced)) {
                // Find the Firestore item by zohoId
                const itemQuery = await db
                    .collection('organizations')
                    .doc(organizationId)
                    .collection('inventory')
                    .where('zohoId', '==', zohoItemId)
                    .limit(1)
                    .get();
                
                if (!itemQuery.empty) {
                    const itemDoc = itemQuery.docs[0];
                    batch.update(itemDoc.ref, {
                        lastUsed: usageData.date,
                        lastInvoiceNumber: usageData.invoiceNumber,
                        usageCount: admin.firestore.FieldValue.increment(1),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    updateCount++;
                }
            }
            
            if (updateCount > 0) {
                await batch.commit();
                console.log(`✅ Updated ${updateCount} items with invoice usage data`);
            }
            
            // Store sync metadata
            await db
                .collection('organizations')
                .doc(organizationId)
                .collection('metadata')
                .doc('invoice_sync')
                .set({
                    lastSyncTimestamp: new Date().toISOString(),
                    invoicesProcessed: totalInvoices,
                    itemsUpdated: updateCount,
                    lastSyncStatus: 'success'
                }, { merge: true });
            
            return {
                itemsUpdated: updateCount,
                invoicesProcessed: totalInvoices
            };
            
        } catch (error) {
            console.error('❌ Failed to sync invoice usage:', error);
            throw error;
        }
    }

    /**
     * Test the connection to Zoho Books
     */
    async testConnection() {
        try {
            console.log('🔍 Testing Zoho Books connection...');
            
            const organizations = await this.getOrganization();
            
            if (organizations && organizations.length > 0) {
                const org = organizations[0];
                console.log('✅ Zoho Books connection successful');
                return {
                    success: true,
                    message: 'Connected to Zoho Books successfully',
                    organizationId: org.organization_id,
                    organizationName: org.name
                };
            } else {
                throw new Error('No organizations found');
            }
        } catch (error) {
            console.error('❌ Zoho Books connection test failed:', error);
            return {
                success: false,
                message: 'Failed to connect to Zoho Books',
                error: error.response?.data?.message || error.message
            };
        }
    }
}

module.exports = new ZohoService();