// API configuration utility
// Automatically detects the correct API base URL for network access

/**
 * Get the correct API base URL based on environment and access method
 */
export const getApiBaseUrl = (): string => {
  // Check if there's an environment variable override
  const envApiUrl = import.meta.env.VITE_API_BASE_URL;
  if (envApiUrl) {
    return envApiUrl;
  }

  // Auto-detect based on current window location
  if (typeof window !== 'undefined') {
    const currentHost = window.location.hostname;
    
    // If accessing via localhost, use localhost for API
    if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    
    // If accessing via IP address or network, use the same host for API
    return `http://${currentHost}:4000`;
  }

  // Fallback for server-side rendering or when window is not available
  return 'http://localhost:4000';
};

// Pre-computed API base URL
export const API_BASE_URL = getApiBaseUrl();

// Common API endpoints
export const API_ENDPOINTS = {
  createUser: `${API_BASE_URL}/api/admin/createUser`,
  zohoItems: (orgId: string) => `${API_BASE_URL}/api/zoho/items?orgId=${orgId}`,
  zohoSyncInvoices: `${API_BASE_URL}/api/zoho/sync-invoice-usage`,
  zohoAuthUrl: (organizationId: string, userId: string) => 
    `${API_BASE_URL}/api/zoho/auth/url?organizationId=${organizationId}&userId=${userId}`,
  zohoAuthCallback: `${API_BASE_URL}/api/zoho/auth/callback`,
  zohoConfig: `${API_BASE_URL}/api/zoho/config`,
  zohoConfigGet: (orgId: string) => `${API_BASE_URL}/api/zoho/config?orgId=${orgId}`,
  zohoProcessApproval: (organizationId: string, approvalId: string) =>
    `${API_BASE_URL}/api/zoho/approvals/${approvalId}/process?orgId=${organizationId}`,
  zohoProcessSession: (organizationId: string) =>
    `${API_BASE_URL}/api/zoho/approvals/session/process?orgId=${organizationId}`,
  zohoPullQuantities: (organizationId: string) =>
    `${API_BASE_URL}/api/zoho/sync/pull-quantities?orgId=${organizationId}`,
  devicesRegister: `${API_BASE_URL}/api/devices/register`,
  // POS integration endpoints
  posProviders: `${API_BASE_URL}/api/pos/providers`,
  posConnect: `${API_BASE_URL}/api/pos/connect`,
  posDisconnect: `${API_BASE_URL}/api/pos/disconnect`,
  posTest: (orgId: string) => `${API_BASE_URL}/api/pos/test?orgId=${orgId}`,
  posStatus: (orgId: string) => `${API_BASE_URL}/api/pos/status?orgId=${orgId}`,
  posItems: (orgId: string, page = 1, limit = 200, search = '') =>
    `${API_BASE_URL}/api/pos/items?orgId=${orgId}&page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
  posAdjustInventory: `${API_BASE_URL}/api/pos/adjust-inventory`,
  posCreateProduct: `${API_BASE_URL}/api/pos/products`,
  posUpdateProduct: (posId: string) => `${API_BASE_URL}/api/pos/products/${encodeURIComponent(posId)}`,
  posDeleteProduct: (posId: string) => `${API_BASE_URL}/api/pos/products/${encodeURIComponent(posId)}`,
};

console.log('🌐 API Base URL configured:', API_BASE_URL);