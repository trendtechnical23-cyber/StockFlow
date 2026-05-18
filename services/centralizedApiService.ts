/**
 * Centralized API Service
 * 
 * Migrated from direct Firestore usage to use the centralized FirestoreService
 * Provides consistent error handling and organization-scoped operations
 */

import { firestoreService } from './firestoreService';
import { InventoryItem, User, UserRole } from '../types';

class CentralizedApiService {
  private static instance: CentralizedApiService;

  static getInstance(): CentralizedApiService {
    if (!CentralizedApiService.instance) {
      CentralizedApiService.instance = new CentralizedApiService();
    }
    return CentralizedApiService.instance;
  }

  /**
   * Get inventory using centralized service with proper organization scoping
   */
  async getInventory(organizationId: string, limitCount: number = 200): Promise<InventoryItem[]> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      return await firestoreService.getActiveInventory(organizationId, limitCount);
    } catch (error) {
      console.error('❌ Error getting inventory through centralized API:', error);
      throw new Error(`Failed to fetch inventory: ${error}`);
    }
  }

  /**
   * Get users using centralized service with role management
   */
  async getUsers(organizationId: string): Promise<User[]> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const members = await firestoreService.getMembers(organizationId);
      
      // Convert OrgMember to User format for backward compatibility
      return members.map(member => ({
        uid: member.userId,
        name: member.name || '',
        email: member.email || '',
        role: member.role as UserRole,
        organizationId: organizationId,
        invited: false, // Existing members are not invited
        invitedAt: undefined
      }));
    } catch (error) {
      console.error('❌ Error getting users through centralized API:', error);
      throw new Error(`Failed to fetch users: ${error}`);
    }
  }

  /**
   * Get activity logs using centralized service
   */
  async getLogs(organizationId: string, limitCount: number = 100): Promise<any[]> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      return await firestoreService.getActivityLogs(organizationId, limitCount);
    } catch (error) {
      console.error('❌ Error getting logs through centralized API:', error);
      throw new Error(`Failed to fetch logs: ${error}`);
    }
  }

  /**
   * Add inventory item using centralized service
   */
  async addInventoryItem(organizationId: string, item: Omit<InventoryItem, 'id'>): Promise<string> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const itemId = await firestoreService.createInventoryItem(organizationId, item);
      
      // Log the activity
      await firestoreService.createActivityLog(organizationId, {
        action: 'create',
        target: 'inventory',
        user: 'system', // TODO: Pass actual user from calling context
        userName: 'System',
        description: `Created item: ${item.name}`,
        metadata: {
          itemId,
          itemName: item.name,
          sku: item.sku
        }
      });

      return itemId;
    } catch (error) {
      console.error('❌ Error adding inventory item through centralized API:', error);
      throw new Error(`Failed to add inventory item: ${error}`);
    }
  }

  /**
   * Update inventory item using centralized service
   */
  async updateInventoryItem(
    organizationId: string, 
    itemId: string, 
    updates: Partial<InventoryItem>,
    userId?: string,
    userName?: string
  ): Promise<void> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      await firestoreService.updateInventoryItem(organizationId, itemId, updates);
      
      // Log the activity
      if (userId && userName) {
        await firestoreService.createActivityLog(organizationId, {
          action: 'update',
          target: 'inventory',
          user: userId,
          userName,
          description: `Updated item: ${updates.name || 'Unknown'}`,
          metadata: {
            itemId,
            updates: Object.keys(updates)
          }
        });
      }
    } catch (error) {
      console.error('❌ Error updating inventory item through centralized API:', error);
      throw new Error(`Failed to update inventory item: ${error}`);
    }
  }

  /**
   * Delete inventory item using centralized service
   */
  async deleteInventoryItem(
    organizationId: string, 
    itemId: string,
    userId?: string,
    userName?: string,
    itemName?: string
  ): Promise<void> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      await firestoreService.deleteInventoryItem(organizationId, itemId);
      
      // Log the activity
      if (userId && userName) {
        await firestoreService.createActivityLog(organizationId, {
          action: 'delete',
          target: 'inventory',
          user: userId,
          userName,
          description: `Deleted item: ${itemName || 'Unknown'}`,
          metadata: {
            itemId,
            itemName
          }
        });
      }
    } catch (error) {
      console.error('❌ Error deleting inventory item through centralized API:', error);
      throw new Error(`Failed to delete inventory item: ${error}`);
    }
  }

  /**
   * Search inventory using centralized service
   */
  async searchInventory(
    organizationId: string, 
    searchTerm: string, 
    limitCount: number = 50
  ): Promise<InventoryItem[]> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      return await firestoreService.searchInventory(organizationId, searchTerm, limitCount);
    } catch (error) {
      console.error('❌ Error searching inventory through centralized API:', error);
      throw new Error(`Failed to search inventory: ${error}`);
    }
  }

  /**
   * Get low stock items using centralized service
   */
  async getLowStockItems(organizationId: string): Promise<InventoryItem[]> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      return await firestoreService.getLowStockItems(organizationId);
    } catch (error) {
      console.error('❌ Error getting low stock items through centralized API:', error);
      throw new Error(`Failed to get low stock items: ${error}`);
    }
  }

  /**
   * Add user using centralized service
   */
  async addUser(
    organizationId: string,
    user: {
      uid: string;
      email: string;
      displayName: string;
      role: UserRole;
      isActive?: boolean;
    }
  ): Promise<void> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      await firestoreService.setMember(organizationId, user.uid, {
        userId: user.uid,
        email: user.email,
        name: user.displayName, // Map displayName to name property
        role: user.role,
        joinedAt: new Date() // Add required joinedAt property
      });

      // Log the activity
      await firestoreService.createActivityLog(organizationId, {
        action: 'create',
        target: 'user',
        user: 'system',
        userName: 'System',
        description: `Added user: ${user.displayName}`,
        metadata: {
          userId: user.uid,
          userEmail: user.email,
          userRole: user.role
        }
      });
    } catch (error) {
      console.error('❌ Error adding user through centralized API:', error);
      throw new Error(`Failed to add user: ${error}`);
    }
  }

  /**
   * Update user role using centralized service
   */
  async updateUserRole(
    organizationId: string,
    userId: string,
    newRole: UserRole,
    updatedBy?: string,
    updatedByName?: string
  ): Promise<void> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      await firestoreService.updateMemberRole(organizationId, userId, newRole);

      // Log the activity
      if (updatedBy && updatedByName) {
        await firestoreService.createActivityLog(organizationId, {
          action: 'update',
          target: 'user',
          user: updatedBy,
          userName: updatedByName,
          description: `Updated user role to: ${newRole}`,
          metadata: {
            targetUserId: userId,
            newRole,
            previousRole: 'unknown' // Could be enhanced to track previous role
          }
        });
      }
    } catch (error) {
      console.error('❌ Error updating user role through centralized API:', error);
      throw new Error(`Failed to update user role: ${error}`);
    }
  }

  /**
   * Remove user using centralized service
   */
  async removeUser(
    organizationId: string,
    userId: string,
    removedBy?: string,
    removedByName?: string,
    userDisplayName?: string
  ): Promise<void> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      await firestoreService.removeMember(organizationId, userId);

      // Log the activity
      if (removedBy && removedByName) {
        await firestoreService.createActivityLog(organizationId, {
          action: 'delete',
          target: 'user',
          user: removedBy,
          userName: removedByName,
          description: `Removed user: ${userDisplayName || 'Unknown'}`,
          metadata: {
            removedUserId: userId,
            removedUserName: userDisplayName
          }
        });
      }
    } catch (error) {
      console.error('❌ Error removing user through centralized API:', error);
      throw new Error(`Failed to remove user: ${error}`);
    }
  }

  /**
   * Create notification using centralized service
   */
  async createNotification(
    organizationId: string,
    notification: {
      userId: string;
      type: string;
      title: string;
      message: string;
      data?: any;
    }
  ): Promise<string> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      const notificationDoc = {
        ...notification,
      };

      return await firestoreService.createNotification(organizationId, notificationDoc as any);
    } catch (error) {
      console.error('❌ Error creating notification through centralized API:', error);
      throw new Error(`Failed to create notification: ${error}`);
    }
  }

  /**
   * Get user notifications using centralized service
   */
  async getUserNotifications(
    organizationId: string,
    userId: string,
    limitCount: number = 50
  ): Promise<any[]> {
    try {
      if (!organizationId) {
        throw new Error('Organization ID is required');
      }

      return await firestoreService.getUserNotifications(organizationId, userId, limitCount);
    } catch (error) {
      console.error('❌ Error getting user notifications through centralized API:', error);
      throw new Error(`Failed to get user notifications: ${error}`);
    }
  }
}

export const centralizedApiService = CentralizedApiService.getInstance();
export default centralizedApiService;