// Multi-Tenant Zoho Books API Service - Development Version
interface ZohoTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  scope: string;
  api_domain?: string;
}

interface ZohoItem {
  item_id: string;
  name: string;
  sku?: string;
  description?: string;
  rate: number;
  purchase_rate?: number;
  // Various stock/quantity field names from Zoho Books
  available_stock?: number;
  stock_on_hand?: number;
  actual_available_stock?: number;
  actual_available_for_sale_stock?: number;
  available_for_sale_stock?: number;
  quantity?: number;
  quantity_on_hand?: number;
  current_stock?: number;
  reorder_level?: number;
  minimum_order_quantity?: number;
  category_name?: string;
  category_id?: string;
  item_type?: string;
  product_type?: string;
  status: string;
  last_modified_time?: string;
  created_time?: string;
  // Additional fields that might contain inventory data
  warehouse_stocks?: Array<{
    warehouse_id: string;
    warehouse_name: string;
    stock_on_hand: number;
    available_stock: number;
    actual_available_stock: number;
  }>;
  unit?: string;
  inventory_account_id?: string;
  is_combo_product?: boolean;
}

interface ZohoOrganization {
  organization_id: string;
  name: string;
  currency_code: string;
  time_zone: string;
}

export class ZohoService {
  // No hardcoded credentials — multi-tenant OAuth is handled entirely by the backend.
  // The frontend only needs to call /api/zoho/auth/url and /api/zoho/auth/callback.
  private static baseUrl = import.meta.env.VITE_ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com';
  private static booksApiUrl = import.meta.env.VITE_ZOHO_BOOKS_API_URL || 'https://www.zohoapis.com/books/v3';

  // Always considered configured — credentials are checked per-org on the backend
  static isConfigured(): boolean {
    return true;
  }

  /**
   * Generate OAuth URL — delegates to backend /api/zoho/auth/url for multi-tenant support.
   * This method is kept for backward compatibility but callers should use the backend endpoint directly.
   */
  static getAuthUrl(organizationId: string, userId: string): string {
    throw new Error('OAuth URL generation has moved to the backend. Use /api/zoho/auth/url endpoint instead.');
  }

  /**
   * Exchange authorization code for tokens — handled by backend /api/zoho/auth/callback.
   * This static method is kept for backward compatibility but is NOT used in the current flow.
   */
  static async exchangeCodeForTokens(code: string, state: string): Promise<{ tokens: ZohoTokens, organizationId: string, userId: string }> {
    throw new Error('Token exchange has moved to the backend. Use /api/zoho/auth/callback endpoint instead.');
  }

  /**
   * Refresh access token — handled by the backend per-org.
   * The frontend should NOT call Zoho token endpoints directly.
   */
  static async refreshAccessToken(refreshToken: string): Promise<ZohoTokens> {
    throw new Error('Token refresh is handled by the backend. Frontend should not call Zoho token endpoints directly.');
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  static async getValidAccessToken(organizationId: string): Promise<string | null> {
    try {
      // Get tokens from Realtime Database for this organization
      const { database } = await import('./firebase');
      const { ref, get, update } = await import('firebase/database');
      
      const tokenSnapshot = await get(ref(database, `zoho_tokens/${organizationId}`));
      
      if (!tokenSnapshot.exists()) {
        return null; // No tokens found
      }

  const tokenData = tokenSnapshot.val() as ZohoTokens;
      
      // Check if token is expired (with 5 minute buffer)
      const now = Date.now();
      const expiresAt = tokenData.expires_at || 0;
      
      if (now < (expiresAt - 300000)) { // 5 minutes buffer
        return tokenData.access_token; // Token is still valid
      }

      // Token is expired, refresh it
      const refreshedTokens = await this.refreshAccessToken(tokenData.refresh_token);
      
      // Update tokens in Realtime Database
      await update(ref(database, `zoho_tokens/${organizationId}`), {
        access_token: refreshedTokens.access_token,
        expires_in: refreshedTokens.expires_in,
        expires_at: refreshedTokens.expires_at,
        updated_at: new Date().toISOString()
      });

      return refreshedTokens.access_token;
    } catch (error) {
      console.error('Error getting valid access token:', error);
      return null;
    }
  }

  /**
   * Make authenticated API call to Zoho Books
   */
  static async makeAuthenticatedRequest(organizationId: string, endpoint: string, options: RequestInit = {}): Promise<any> {
    const accessToken = await this.getValidAccessToken(organizationId);
    
    if (!accessToken) {
      throw new Error('No valid access token available. Please reconnect to Zoho Books.');
    }

    // Determine API base: prefer api_domain from stored tokens, fallback to env
    let apiDomain: string | undefined;
    try {
      const { database } = await import('./firebase');
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(database, `zoho_tokens/${organizationId}`));
      if (snap.exists()) {
        apiDomain = (snap.val()?.api_domain as string | undefined) || undefined;
      }
    } catch {}

    // Use local proxy in development to avoid CORS issues, but still target the correct upstream domain in the proxy
    const booksBase = import.meta.env.DEV
      ? 'http://localhost:3001/api/zoho/books'
      : (apiDomain ? `${apiDomain.replace(/\/$/, '')}/books/v3` : this.booksApiUrl);

    const response = await fetch(`${booksBase}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Accept': 'application/json',
        ...(import.meta.env.DEV && apiDomain ? { 'X-Zoho-Api-Domain': apiDomain } : {}),
        ...options.headers
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new Error(`Zoho Books connection expired. ${body || ''}`.trim());
      }
      throw new Error(`Zoho API error: ${response.status} ${response.statusText} ${body ? '- ' + body : ''}`.trim());
    }

    return response.json();
  }

  /**
   * Get Zoho organizations for a connected account
   */
  static async getZohoOrganizations(organizationId: string): Promise<ZohoOrganization[]> {
    const response = await this.makeAuthenticatedRequest(organizationId, '/organizations');
    return response.organizations || [];
  }

  /**
   * Import items from Zoho Books for a specific organization
   */
  static async importItems(organizationId: string): Promise<any[]> {
    try {
      // Resolve Zoho organization id from Zoho API
      let zohoOrgId: string;
      console.log('ℹ️ Fetching Zoho organizations to resolve organization_id...');
      const orgs = await this.getZohoOrganizations(organizationId);
      if (!orgs || orgs.length === 0) {
        throw new Error('No Zoho organizations found for this account');
      }
      zohoOrgId = orgs[0].organization_id;
      console.log('✅ Using Zoho organization:', { id: zohoOrgId, name: orgs[0].name });

      // Fetch all items from Zoho Books with pagination
      let allItems: ZohoItem[] = [];
      let page = 1;
      const perPage = 200; // Zoho's max per page
      let hasMoreItems = true;

      while (hasMoreItems) {
        console.log(`📄 Fetching page ${page} of Zoho items...`);
        const itemsResponse = await this.makeAuthenticatedRequest(
          organizationId,
          `/items?organization_id=${zohoOrgId}&page=${page}&per_page=${perPage}`
        );

        const pageItems = itemsResponse.items || [];
        allItems.push(...pageItems);

        // Check if there are more items
        const pageInfo = itemsResponse.page_context;
        hasMoreItems = pageInfo && pageInfo.has_more_page;
        page++;

        console.log(`📊 Loaded ${pageItems.length} items (total: ${allItems.length})`);
      }

      console.log(`✅ Loaded all ${allItems.length} items from Zoho Books`);

      // Log sample of raw items for debugging
      if (allItems.length > 0) {
        console.log('📋 Sample Zoho item structure:', JSON.stringify(allItems[0], null, 2));
        console.log('📊 Available quantity fields in first item:', {
          available_stock: allItems[0].available_stock,
          stock_on_hand: allItems[0].stock_on_hand,
          actual_available_stock: allItems[0].actual_available_stock,
          quantity: allItems[0].quantity,
          quantity_on_hand: allItems[0].quantity_on_hand,
          current_stock: allItems[0].current_stock,
          warehouse_stocks: allItems[0].warehouse_stocks
        });
        console.log('💰 Pricing fields in first item:', {
          rate: allItems[0].rate,
          purchase_rate: allItems[0].purchase_rate,
          item_type: allItems[0].item_type
        });
        
        // Log a few items to check pricing data
        console.log('💰 First 5 items pricing check:');
        allItems.slice(0, 5).forEach((item: ZohoItem, i: number) => {
          console.log(`  Item ${i + 1} (${item.name}):`, {
            rate: item.rate,
            purchase_rate: item.purchase_rate,
            hasCost: !!item.purchase_rate,
            hasPrice: !!item.rate
          });
        });
      }

      // Transform Zoho items to your app's InventoryItem format
      const items = allItems.map((item: ZohoItem, index: number) => {
        // Smart quantity detection with multiple fallbacks
        const getQuantity = (item: ZohoItem): number => {
          // Prioritize stock_on_hand since that's what Zoho Books actually uses
          const quantityFields = [
            'stock_on_hand', // Primary field from Zoho Books
            'actual_available_stock',
            'available_stock', 
            'available_for_sale_stock',
            'actual_available_for_sale_stock',
            'quantity_on_hand',
            'quantity',
            'current_stock'
          ];
          
          for (const field of quantityFields) {
            const value = (item as any)[field];
            if (typeof value === 'number' && !isNaN(value)) {
              // Preserve negative quantities (don't use Math.max)
              const quantity = Math.round(value);
              if (index < 5) { // Log first 5 items for debugging
                console.log(`📦 Item "${item.name}" quantity from ${field}: ${value} -> ${quantity}`);
              }
              return quantity;
            }
          }
          
          // Check warehouse stocks as last resort
          if (item.warehouse_stocks && item.warehouse_stocks.length > 0) {
            const totalStock = item.warehouse_stocks.reduce((total, warehouse) => {
              const warehouseStock = warehouse.stock_on_hand || warehouse.actual_available_stock || warehouse.available_stock || 0;
              return total + warehouseStock; // Allow negative warehouse stocks too
            }, 0);
            if (totalStock !== 0) {
              const quantity = Math.round(totalStock);
              if (index < 5) {
                console.log(`🏭 Item "${item.name}" total warehouse stock: ${totalStock} -> ${quantity}`);
              }
              return quantity;
            }
          }
          
          if (index < 5) {
            console.log(`⚠️ Item "${item.name}" no valid quantity found, defaulting to 0`);
            console.log('Available fields:', Object.keys(item).filter(key => 
              key.toLowerCase().includes('stock') || 
              key.toLowerCase().includes('quantity') ||
              key.toLowerCase().includes('available')
            ));
          }
          return 0;
        };

        const stock = getQuantity(item);
        const threshold = Math.max(1, item.reorder_level || item.minimum_order_quantity || 10);
        
        // Validate threshold but preserve negative stock values
        if (isNaN(stock)) {
          console.warn(`⚠️ Invalid stock value for item "${item.name}": ${stock}, setting to 0`);
        }
        
        const finalItem = {
          id: `zoho_${item.item_id}`,
          organizationId: organizationId,
          name: item.name,
          sku: item.sku || `ZOHO-${item.item_id}`,
          category: item.category_name || 'Imported from Zoho',
          stock: isNaN(stock) ? 0 : stock, // Preserve negative values, only fix NaN
          threshold: Math.max(1, threshold), // Ensure threshold is positive
          supplier: 'Zoho Books Import',
          description: item.description || '',
          unit: item.unit || 'each', // Add unit field from Zoho
          // Pricing fields from Zoho Books
          cost: item.purchase_rate && item.purchase_rate > 0 ? parseFloat(item.purchase_rate.toString()) : undefined,
          price: item.rate && item.rate > 0 ? parseFloat(item.rate.toString()) : undefined,
          currency: 'ZAR', // Default currency for South African businesses
          // Sync and caching fields
          lastModified: item.last_modified_time || item.created_time || new Date().toISOString(),
          lastSynced: new Date().toISOString(),
          syncStatus: 'synced' as const,
          source: 'zoho' as const,
          zohoId: item.item_id,
          // Initialize usage analytics
          usageCount: 0,
          totalUsed: 0
        };
        
        // Log negative stock items for debugging
        if (index < 10 && stock < 0) {
          console.log(`🔍 Negative stock item #${index + 1}:`, {
            name: item.name,
            stock: stock,
            unit: item.unit,
            rawItem: item
          });
        }
        
        return finalItem;
      });

      // Log summary of imported quantities
      const stockSummary = {
        totalItems: items.length,
        itemsWithStock: items.filter(item => item.stock > 0).length,
        totalStock: items.reduce((sum, item) => sum + item.stock, 0),
        averageStock: items.length > 0 ? (items.reduce((sum, item) => sum + item.stock, 0) / items.length).toFixed(2) : 0,
        lowStockItems: items.filter(item => item.stock <= item.threshold).length
      };
      console.log('📈 Import summary:', stockSummary);

      return items;
    } catch (error) {
      console.error('Error importing Zoho items:', error);
      throw error;
    }
  }

  /**
   * Store Zoho tokens for an organization
   */
  static async storeTokens(organizationId: string, userId: string, tokens: ZohoTokens): Promise<void> {
    try {
      console.log('💾 Storing tokens for organization:', organizationId);
      console.log('🔍 Tokens to store:', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
        expiresAt: tokens.expires_at,
        tokenType: tokens.token_type,
        scope: tokens.scope
      });

      // Validate required fields
      if (!tokens.access_token) {
        throw new Error('Cannot store tokens: access_token is missing');
      }

      const { database } = await import('./firebase');
      const { ref, set } = await import('firebase/database');
      
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_in: tokens.expires_in || 3600,
        expires_at: tokens.expires_at || (Date.now() + 3600000),
        token_type: tokens.token_type || 'Bearer',
        scope: tokens.scope || '',
        api_domain: tokens.api_domain || null,
        organization_id: organizationId,
        connected_by: userId,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('💾 Final token data to store:', JSON.stringify(tokenData, null, 2));
      
      await set(ref(database, `zoho_tokens/${organizationId}`), tokenData);
      console.log('✅ Tokens stored successfully');
    } catch (error) {
      console.error('Error storing Zoho tokens:', error);
      throw error;
    }
  }

  /**   * Import purchase orders from Zoho Books
   */
  static async importPurchaseOrders(organizationId: string): Promise<any[]> {
    try {
      // Resolve Zoho organization ID from API
      let zohoOrgId: string;
      console.log('ℹ️ Fetching Zoho organizations for PO import...');
      const orgs = await this.getZohoOrganizations(organizationId);
      if (!orgs || orgs.length === 0) {
        throw new Error('No Zoho organizations found for this account');
      }
      zohoOrgId = orgs[0].organization_id;
      console.log('✅ Using Zoho organization:', { id: zohoOrgId, name: orgs[0].name });

      // Fetch purchase orders from Zoho Books
      let allPOs: any[] = [];
      let page = 1;
      const perPage = 200;
      let hasMore = true;

      while (hasMore) {
        console.log(`📄 Fetching page ${page} of Zoho purchase orders...`);
        const response = await this.makeAuthenticatedRequest(
          organizationId,
          `/purchaseorders?organization_id=${zohoOrgId}&page=${page}&per_page=${perPage}&sort_column=date&sort_order=D`
        );

        const pagePOs = response.purchaseorders || [];
        allPOs = allPOs.concat(pagePOs);

        console.log(`✅ Fetched ${pagePOs.length} purchase orders from page ${page}`);
        
        if (pagePOs.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }

      console.log(`✅ Total Zoho purchase orders fetched: ${allPOs.length}`);

      // Transform Zoho POs to our format
      const transformedPOs = allPOs.map((zohoPO: any) => {
        // Map Zoho status to our POStatus
        const mapStatus = (zohoStatus: string): string => {
          switch (zohoStatus?.toLowerCase()) {
            case 'draft': return 'DRAFT';
            case 'open': return 'SENT';
            case 'issued': return 'SENT';
            case 'billed': return 'RECEIVED';
            case 'partially_billed': return 'PARTIALLY_RECEIVED';
            case 'cancelled': return 'CANCELLED';
            case 'closed': return 'CLOSED';
            default: return 'SENT';
          }
        };

        return {
          // Zoho reference
          zohoId: zohoPO.purchaseorder_id,
          zohoNumber: zohoPO.purchaseorder_number,
          
          // Basic info
          title: zohoPO.reference_number || `PO from ${zohoPO.vendor_name}`,
          referenceNumber: zohoPO.purchaseorder_number,
          status: mapStatus(zohoPO.status),
          
          // Supplier info (will need to be matched/created)
          supplierInfo: {
            name: zohoPO.vendor_name,
            zohoId: zohoPO.vendor_id,
            email: zohoPO.email || '',
            phone: zohoPO.phone || ''
          },
          
          // Dates
          issueDate: zohoPO.date ? new Date(zohoPO.date) : new Date(),
          expectedDeliveryDate: zohoPO.delivery_date ? new Date(zohoPO.delivery_date) : undefined,
          
          // Financial
          currency: zohoPO.currency_code || 'ZAR',
          subtotal: parseFloat(zohoPO.sub_total || '0'),
          totalDiscount: parseFloat(zohoPO.discount_amount || '0'),
          totalVAT: parseFloat(zohoPO.tax_total || '0'),
          shippingCost: parseFloat(zohoPO.shipping_charge || '0'),
          grandTotal: parseFloat(zohoPO.total || '0'),
          
          // Line items
          lineItems: (zohoPO.line_items || []).map((item: any, index: number) => ({
            lineNumber: index + 1,
            sku: item.sku || '',
            description: item.name || item.description || '',
            quantityOrdered: parseFloat(item.quantity || '0'),
            quantityReceived: parseFloat(item.quantity_received || '0'),
            unit: item.unit || 'EA',
            unitPrice: parseFloat(item.rate || '0'),
            discountPercentage: item.discount_percentage || 0,
            discountAmount: parseFloat(item.discount_amount || '0'),
            vatRate: parseFloat(item.tax_percentage || '0'),
            vatAmount: parseFloat(item.tax_amount || '0'),
            total: parseFloat(item.item_total || '0'),
            zohoItemId: item.item_id
          })),
          
          // Notes
          internalNotes: zohoPO.notes || '',
          
          // Metadata
          source: 'zoho',
          syncedAt: new Date()
        };
      });

      console.log(`✅ Transformed ${transformedPOs.length} purchase orders`);
      return transformedPOs;
      
    } catch (error) {
      console.error('❌ Error importing purchase orders from Zoho:', error);
      throw error;
    }
  }

  /**   * Remove Zoho tokens for an organization (disconnect)
   */
  static async removeTokens(organizationId: string): Promise<void> {
    try {
      const { database } = await import('./firebase');
      const { ref, remove } = await import('firebase/database');
      
      await remove(ref(database, `zoho_tokens/${organizationId}`));
    } catch (error) {
      console.error('Error removing Zoho tokens:', error);
      throw error;
    }
  }

  /**
   * Check if organization has valid Zoho connection
   */
  static async isConnected(organizationId: string): Promise<boolean> {
    const accessToken = await this.getValidAccessToken(organizationId);
    return accessToken !== null;
  }

  /**
   * Get connection status and info for an organization
   */
  static async getConnectionInfo(organizationId: string): Promise<any> {
    try {
      const { database } = await import('./firebase');
      const { ref, get } = await import('firebase/database');
      
      const tokenSnapshot = await get(ref(database, `zoho_tokens/${organizationId}`));
      
      if (!tokenSnapshot.exists()) {
        return null;
      }

      const tokenData = tokenSnapshot.val();
      const isExpired = Date.now() >= (tokenData.expires_at - 300000); // 5 min buffer
      
      return {
        connected_at: tokenData.connected_at,
        connected_by: tokenData.connected_by,
        expires_at: tokenData.expires_at,
        is_expired: isExpired,
        scope: tokenData.scope
      };
    } catch (error) {
      console.error('Error getting connection info:', error);
      return null;
    }
  }
}