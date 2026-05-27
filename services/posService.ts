/**
 * Frontend POS Integration Service
 * Talks to the backend /api/pos/* endpoints.
 */

import { getAccessToken } from './supabase';
import { API_ENDPOINTS } from '../utils/apiConfig';
import type { PosProvider } from '../types';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export interface PosProviderInfo {
  id: string;
  name: string;
}

export interface PosConnectPayload {
  orgId: string;
  provider: PosProvider;
  baseUrl: string;
  username?: string;
  apiKey: string;
  database?: string;
}

export interface PosMappedItem {
  name: string;
  sku: string;
  category: string;
  stock: number;
  price: number;
  cost: number;
  threshold: number;
  supplier: string;
  source: 'pos';
  posId: string;
  posProvider: string;
  barcode?: string | null;
  metadata?: { unit?: string; description?: string; location?: string };
}

export const PosService = {
  /** List supported POS providers */
  async getProviders(): Promise<PosProviderInfo[]> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posProviders, { headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to fetch providers');
    return data.providers;
  },

  /** Connect to a POS system (validates credentials first) */
  async connect(payload: PosConnectPayload): Promise<{ success: boolean; message: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posConnect, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data;
  },

  /** Disconnect POS integration */
  async disconnect(orgId: string): Promise<void> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posDisconnect, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to disconnect');
  },

  /** Test an existing connection */
  async testConnection(orgId: string): Promise<{ success: boolean; message: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posTest(orgId), { headers });
    return res.json();
  },

  /** Get integration status (no API key returned) */
  async getStatus(orgId: string): Promise<{
    status: 'connected' | 'disconnected';
    provider?: string;
    baseUrl?: string;
    database?: string;
    connectedAt?: string;
  }> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posStatus(orgId), { headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to get status');
    return data.data;
  },

  /** Fetch products from the POS system */
  async getItems(
    orgId: string,
    page = 1,
    limit = 200,
    search = ''
  ): Promise<{ items: PosMappedItem[]; total: number; hasMore: boolean }> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posItems(orgId, page, limit, search), { headers });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to fetch POS items');
    return {
      items: data.data.items,
      total: data.data.total,
      hasMore: data.data.hasMore,
    };
  },

  /** Adjust on-hand quantity of a POS product (creates a proper stock adjustment) */
  async adjustInventory(
    orgId: string,
    posId: string,
    newQuantity: number,
    reason = 'StockFlow adjustment'
  ): Promise<void> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posAdjustInventory, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orgId, posId, newQuantity, reason }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to adjust POS inventory');
  },

  /** Create a new product in the POS system. Returns the new posId. */
  async createProduct(
    orgId: string,
    productData: Partial<PosMappedItem> & { name: string }
  ): Promise<{ posId: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posCreateProduct, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orgId, productData }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to create POS product');
    return { posId: data.posId };
  },

  /** Update metadata of an existing POS product */
  async updateProduct(
    orgId: string,
    posId: string,
    productData: Partial<PosMappedItem>
  ): Promise<void> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posUpdateProduct(posId), {
      method: 'PUT',
      headers,
      body: JSON.stringify({ orgId, productData }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to update POS product');
  },

  /** Archive (soft-delete) a product in the POS system */
  async deleteProduct(orgId: string, posId: string): Promise<void> {
    const headers = await getAuthHeaders();
    const res = await fetch(API_ENDPOINTS.posDeleteProduct(posId), {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ orgId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to delete POS product');
  },
};
