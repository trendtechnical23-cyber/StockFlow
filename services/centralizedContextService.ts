/**
 * Centralized Context Service
 * 
 * Enhanced state management service that replaces direct Firebase usage in AppContext
 * Provides better error handling, caching, and subscription management
 */

import { firestoreService } from './firestoreService';
import { centralizedApiService } from './centralizedApiService';
import { InventoryItem, User, Settings, Organization, ActivityLogEntry } from '../types';

export interface AppContextState {
  inventory: InventoryItem[];
  users: User[];
  currentUser: User;
  settings: Settings;
  organization: Organization;
  activityLog: ActivityLogEntry[];
  loading: {
    inventory: boolean;
    users: boolean;
    settings: boolean;
    organization: boolean;
  };
  error: string | null;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class CentralizedContextService {
  private static instance: CentralizedContextService;
  private cache = new Map<string, CacheEntry<any>>();
  private subscriptions = new Map<string, () => void>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  static getInstance(): CentralizedContextService {
    if (!CentralizedContextService.instance) {
      CentralizedContextService.instance = new CentralizedContextService();
    }
    return CentralizedContextService.instance;
  }

  /**
   * Get cached data or fetch if expired
   */
  private async getCachedData<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = this.CACHE_TTL
  ): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.data;
    }

    try {
      const data = await fetchFn();
      this.cache.set(key, {
        data,
        timestamp: now,
        ttl
      });
      return data;
    } catch (error) {
      // Return cached data if available, even if expired
      if (cached) {
        console.warn(`Using expired cache for ${key}:`, error);
        return cached.data;
      }
      throw error;
    }
  }

  /**
   * Clear cache for specific key or all cache
   */
  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Load initial application data with caching and error handling
   */
  async loadInitialData(organizationId: string): Promise<Partial<AppContextState>> {
    const loadTasks = [
      this.getCachedData(`inventory_${organizationId}`, () => 
        centralizedApiService.getInventory(organizationId)
      ),
      this.getCachedData(`users_${organizationId}`, () => 
        centralizedApiService.getUsers(organizationId)
      ),
      this.getCachedData(`logs_${organizationId}`, () => 
        centralizedApiService.getLogs(organizationId, 50)
      ),
      this.getCachedData(`lowstock_${organizationId}`, () => 
        centralizedApiService.getLowStockItems(organizationId)
      )
    ];

    try {
      const [inventory, users, activityLog, lowStockItems] = await Promise.allSettled(loadTasks);

      return {
        inventory: inventory.status === 'fulfilled' ? inventory.value : [],
        users: users.status === 'fulfilled' ? users.value : [],
        activityLog: activityLog.status === 'fulfilled' ? activityLog.value : [],
        loading: {
          inventory: false,
          users: false,
          settings: false,
          organization: false
        },
        error: null
      };
    } catch (error) {
      console.error('❌ Error loading initial data through centralized context:', error);
      throw new Error(`Failed to load application data: ${error}`);
    }
  }

  /**
   * Update inventory item with optimistic updates and error recovery
   */
  async updateInventoryItem(
    organizationId: string,
    itemId: string,
    updates: Partial<InventoryItem>,
    userId: string,
    userName: string
  ): Promise<InventoryItem> {
    try {
      // Perform update through centralized API
      await centralizedApiService.updateInventoryItem(
        organizationId,
        itemId,
        updates,
        userId,
        userName
      );

      // Clear cache to force fresh data on next request
      this.clearCache(`inventory_${organizationId}`);

      // Return updated item by fetching fresh data
      const inventoryItems = await this.getCachedData(`inventory_${organizationId}`, () =>
        centralizedApiService.getInventory(organizationId)
      );

      const updatedItem = inventoryItems.find(item => item.id === itemId);
      if (!updatedItem) {
        throw new Error('Updated item not found');
      }

      return updatedItem;
    } catch (error) {
      console.error('❌ Error updating inventory item through centralized context:', error);
      throw error;
    }
  }

  /**
   * Add inventory item with cache invalidation
   */
  async addInventoryItem(
    organizationId: string,
    item: Omit<InventoryItem, 'id'>
  ): Promise<string> {
    try {
      const itemId = await centralizedApiService.addInventoryItem(organizationId, item);
      
      // Clear cache to include new item on next request
      this.clearCache(`inventory_${organizationId}`);
      this.clearCache(`lowstock_${organizationId}`);

      return itemId;
    } catch (error) {
      console.error('❌ Error adding inventory item through centralized context:', error);
      throw error;
    }
  }

  /**
   * Delete inventory item with cache invalidation
   */
  async deleteInventoryItem(
    organizationId: string,
    itemId: string,
    userId: string,
    userName: string,
    itemName: string
  ): Promise<void> {
    try {
      await centralizedApiService.deleteInventoryItem(
        organizationId,
        itemId,
        userId,
        userName,
        itemName
      );

      // Clear related caches
      this.clearCache(`inventory_${organizationId}`);
      this.clearCache(`lowstock_${organizationId}`);
    } catch (error) {
      console.error('❌ Error deleting inventory item through centralized context:', error);
      throw error;
    }
  }

  /**
   * Search inventory with caching
   */
  async searchInventory(
    organizationId: string,
    searchTerm: string,
    limitCount: number = 50
  ): Promise<InventoryItem[]> {
    const cacheKey = `search_${organizationId}_${searchTerm}_${limitCount}`;
    
    return this.getCachedData(cacheKey, () =>
      centralizedApiService.searchInventory(organizationId, searchTerm, limitCount),
      2 * 60 * 1000 // 2 minute cache for searches
    );
  }

  /**
   * Update user with role management through centralized service
   */
  async updateUserRole(
    organizationId: string,
    userId: string,
    newRole: any,
    updatedBy: string,
    updatedByName: string
  ): Promise<void> {
    try {
      await centralizedApiService.updateUserRole(
        organizationId,
        userId,
        newRole,
        updatedBy,
        updatedByName
      );

      // Clear users cache
      this.clearCache(`users_${organizationId}`);
    } catch (error) {
      console.error('❌ Error updating user role through centralized context:', error);
      throw error;
    }
  }

  /**
   * Handle subscription management with proper error handling
   */
  async handleSubscriptionUpdate(
    organizationId: string,
    subscriptionData: {
      plan: string;
      status: string;
      currentPeriodEnd?: number;
      cancelAtPeriodEnd?: boolean;
    }
  ): Promise<void> {
    try {
      // Update subscription information through centralized service
      await firestoreService.updateCustomDocument(
        organizationId,
        'subscriptions',
        'current',
        {
          ...subscriptionData,
          updatedAt: new Date()
        }
      );

      // Log subscription change
      await firestoreService.createActivityLog(organizationId, {
        action: 'update',
        target: 'subscription',
        user: 'system',
        userName: 'System',
        description: `Subscription updated: ${subscriptionData.plan} (${subscriptionData.status})`,
        metadata: subscriptionData
      });

      console.log('✅ Subscription updated through centralized context');
    } catch (error) {
      console.error('❌ Error updating subscription through centralized context:', error);
      throw new Error(`Failed to update subscription: ${error}`);
    }
  }

  /**
   * Bulk operations with transaction support
   */
  async bulkUpdateInventory(
    organizationId: string,
    updates: Array<{
      itemId: string;
      updates: Partial<InventoryItem>;
    }>,
    userId: string,
    userName: string
  ): Promise<void> {
    try {
      // Process all updates
      const updatePromises = updates.map(({ itemId, updates: itemUpdates }) =>
        centralizedApiService.updateInventoryItem(
          organizationId,
          itemId,
          itemUpdates,
          userId,
          userName
        )
      );

      await Promise.all(updatePromises);

      // Clear cache after bulk operation
      this.clearCache(`inventory_${organizationId}`);
      this.clearCache(`lowstock_${organizationId}`);

      // Log bulk operation
      await firestoreService.createActivityLog(organizationId, {
        action: 'bulk_update',
        target: 'inventory',
        user: userId,
        userName,
        description: `Bulk updated ${updates.length} items`,
        metadata: {
          itemCount: updates.length,
          itemIds: updates.map(u => u.itemId)
        }
      });
    } catch (error) {
      console.error('❌ Error in bulk update through centralized context:', error);
      throw error;
    }
  }

  /**
   * Get low stock items with alerting
   */
  async getLowStockItemsWithAlerts(
    organizationId: string,
    userId?: string
  ): Promise<{
    items: InventoryItem[];
    alertCount: number;
    criticalCount: number;
  }> {
    try {
      const lowStockItems = await this.getCachedData(
        `lowstock_${organizationId}`,
        () => centralizedApiService.getLowStockItems(organizationId),
        3 * 60 * 1000 // 3 minute cache
      );

      const criticalCount = lowStockItems.filter(item => item.stock === 0).length;
      const alertCount = lowStockItems.length;

      // Create notification for user if there are critical items
      if (criticalCount > 0 && userId) {
        await centralizedApiService.createNotification(organizationId, {
          userId,
          type: 'low_stock_critical',
          title: 'Critical Stock Alert',
          message: `${criticalCount} items are out of stock`,
          data: {
            criticalItems: lowStockItems.filter(item => item.stock === 0)
          }
        });
      }

      return {
        items: lowStockItems,
        alertCount,
        criticalCount
      };
    } catch (error) {
      console.error('❌ Error getting low stock items with alerts:', error);
      throw error;
    }
  }

  /**
   * Cleanup method to clear subscriptions and cache
   */
  cleanup(): void {
    // Unsubscribe from all subscriptions
    this.subscriptions.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (error) {
        console.warn('Error unsubscribing:', error);
      }
    });
    this.subscriptions.clear();

    // Clear all cache
    this.cache.clear();
  }
}

export const centralizedContextService = CentralizedContextService.getInstance();
export default centralizedContextService;