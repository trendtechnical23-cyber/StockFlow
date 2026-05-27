// New HTTP API Service for Express Backend Integration
import { InventoryItem, ActivityLogEntry } from '../types';
import { getAccessToken } from './supabase';
import { API_BASE_URL as DETECTED_API_BASE_URL } from '../utils/apiConfig';

// Backend API Configuration
// Use the shared API base URL helper so this works over LAN/NGROK/etc.
const API_BASE_URL = `${DETECTED_API_BASE_URL}/api`;

/**
 * Get Supabase access token for authentication
 */
const getAuthToken = async (): Promise<string> => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('User not authenticated');
  }
  return token;
};

/**
 * Make authenticated API request
 */
const apiRequest = async (
  endpoint: string, 
  options: RequestInit = {}
): Promise<Response> => {
  const token = await getAuthToken();
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
  }
  
  return response;
};

/**
 * Stock Management API
 */
export const stockAPI = {
  /**
   * Update stock quantity
   */
  updateStock: async (params: {
    itemId: string;
    orgId: string;
    qtyChange: number;
    reason?: string;
  }) => {
    console.log('📦 Updating stock via API:', params);
    
    const response = await apiRequest('/stock/update', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    
    return await response.json();
  }
};

/**
 * Device Management API
 */
export const deviceAPI = {
  /**
   * Register device for push notifications
   */
  registerDevice: async (deviceToken: string) => {
    console.log('📱 Registering device token via API');
    
    const response = await apiRequest('/devices/register', {
      method: 'POST',
      body: JSON.stringify({ deviceToken })
    });
    
    return await response.json();
  },
  
  /**
   * Unregister device token
   */
  unregisterDevice: async (deviceToken: string) => {
    console.log('📱 Unregistering device token via API');
    
    const response = await apiRequest('/devices/unregister', {
      method: 'POST',
      body: JSON.stringify({ deviceToken })
    });
    
    return await response.json();
  }
};

/**
 * Data Retrieval API
 */
export const dataAPI = {
  /**
   * Get inventory data
   */
  getInventory: async (orgId: string, options?: {
    orderBy?: string;
    order?: 'asc' | 'desc';
    limit?: number;
    startAfter?: string;
  }) => {
    console.log('📋 Fetching inventory via API for org:', orgId);
    
    const queryParams = new URLSearchParams();
    if (options?.orderBy) queryParams.set('orderBy', options.orderBy);
    if (options?.order) queryParams.set('order', options.order);
    if (options?.limit) queryParams.set('limit', options.limit.toString());
    if (options?.startAfter) queryParams.set('startAfter', options.startAfter);
    
    const endpoint = `/inventory/${orgId}${queryParams.toString() ? `?${queryParams}` : ''}`;
    const response = await apiRequest(endpoint);
    
    return await response.json();
  },
  
  /**
   * Get activity logs
   */
  getActivityLogs: async (orgId: string, options?: {
    orderBy?: string;
    order?: 'asc' | 'desc';
    limit?: number;
    startAfter?: string;
  }) => {
    console.log('📊 Fetching activity logs via API for org:', orgId);
    
    const queryParams = new URLSearchParams();
    if (options?.orderBy) queryParams.set('orderBy', options.orderBy);
    if (options?.order) queryParams.set('order', options.order);
    if (options?.limit) queryParams.set('limit', options.limit.toString());
    if (options?.startAfter) queryParams.set('startAfter', options.startAfter);
    
    const endpoint = `/activity/${orgId}${queryParams.toString() ? `?${queryParams}` : ''}`;
    const response = await apiRequest(endpoint);
    
    return await response.json();
  }
};

/**
 * Admin API
 */
export const adminAPI = {
  /**
   * Set user organization
   */
  setUserOrganization: async (params: {
    uid: string;
    orgId: string;
    roles: string[];
    bootstrapSecret?: string;
  }) => {
    console.log('👥 Setting user organization via API');
    
    const response = await apiRequest('/admin/setUserOrg', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    
    return await response.json();
  }
};

/**
 * Health check
 */
export const healthCheck = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL.replace('/api', '')}/health`);
    return response.ok;
  } catch (error) {
    console.error('❌ Backend health check failed:', error);
    return false;
  }
};

// Export API base URL for reference
export { API_BASE_URL };