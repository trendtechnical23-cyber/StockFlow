// Enhanced API Service with Backend Integration
import { stockAPI, deviceAPI, dataAPI, adminAPI, healthCheck } from './backendAPI';
import { API_BASE_URL } from '../utils/apiConfig';
import * as originalAPI from './apiService';

/**
 * Configuration to enable/disable backend integration
 */
const USE_BACKEND_API = true; // Set to false to use Firebase directly

/**
 * Enhanced stock update function that uses backend API when available
 */
export const updateItemWithBackend = async (
  updatedItem: any, 
  orgId: string,
  oldItem?: any
): Promise<void> => {
  if (USE_BACKEND_API) {
    try {
      // Check if backend is available
      const isBackendHealthy = await healthCheck();
      
      if (isBackendHealthy && oldItem && oldItem.stock !== updatedItem.stock) {
        // Calculate stock operation
        const stockDifference = updatedItem.stock - oldItem.stock;
        const operation = stockDifference > 0 ? 'add' : 'subtract';
        const quantity = Math.abs(stockDifference);
        
        console.log('🔄 Using backend API for stock update');
        
        // Update via backend API (this will also create activity logs and send notifications)
        await stockAPI.updateStock({
          itemId: updatedItem.id,
          orgId: orgId,
          qtyChange: stockDifference, // Send the actual change amount
          reason: 'Frontend stock update'
        });
        
        console.log('✅ Stock updated via backend API');
      }
      
      // Always update Firebase for UI consistency
      await originalAPI.updateInventoryItem(updatedItem, orgId);
      
    } catch (error) {
      console.warn('⚠️ Backend API failed, falling back to Firebase:', error);
      // Fallback to Firebase only
      await originalAPI.updateInventoryItem(updatedItem, orgId);
    }
  } else {
    // Use Firebase directly
    await originalAPI.updateInventoryItem(updatedItem, orgId);
  }
};

/**
 * Register device for push notifications
 */
export const registerDeviceToken = async (token: string): Promise<void> => {
  if (USE_BACKEND_API) {
    try {
      const isBackendHealthy = await healthCheck();
      if (isBackendHealthy) {
        await deviceAPI.registerDevice(token);
        console.log('✅ Device registered via backend API');
        return;
      }
    } catch (error) {
      console.warn('⚠️ Device registration via backend failed:', error);
    }
  }
  
  // Fallback or default behavior
  console.log('📱 Device registration fallback (implement if needed)');
};

/**
 * Set user organization via backend API
 */
export const setUserOrganization = async (params: {
  uid: string;
  orgId: string;
  roles: string[];
  bootstrapSecret?: string;
}): Promise<void> => {
  if (USE_BACKEND_API) {
    const isBackendHealthy = await healthCheck();
    if (isBackendHealthy) {
      await adminAPI.setUserOrganization(params);
      console.log('✅ User organization set via backend API');
      return;
    }
  }
  
  throw new Error('Backend API not available for user organization management');
};

/**
 * Backend health status
 */
export const getBackendHealth = async (): Promise<{
  isHealthy: boolean;
  apiUrl: string;
  usingBackend: boolean;
}> => {
  if (!USE_BACKEND_API) {
    return {
      isHealthy: false,
      apiUrl: 'Backend integration disabled',
      usingBackend: false
    };
  }
  
  try {
    const isHealthy = await healthCheck();
    return {
      isHealthy,
      apiUrl: `${API_BASE_URL}/api`,
      usingBackend: USE_BACKEND_API
    };
  } catch (error) {
    return {
      isHealthy: false,
      apiUrl: `${API_BASE_URL}/api (unavailable)`,
      usingBackend: USE_BACKEND_API
    };
  }
};

// Re-export all original API functions for backward compatibility
export * from './apiService';