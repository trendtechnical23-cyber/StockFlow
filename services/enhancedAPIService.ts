/**
 * Enhanced API Service Integration Layer
 * Bridges existing API calls with new robust Firebase structure
 * Maintains backward compatibility while adding proper data organization
 */

import { enhancedDataService } from './enhancedDataService';
import { ActivityLogEntry, InventoryItem, User } from '../types';

class EnhancedAPIService {
  /**
   * Create organization with robust structure
   */
  async createOrganization(orgData: {
    id: string;
    name: string;
    domain?: string;
    adminEmail: string;
    plan?: string;
  }): Promise<void> {
    return enhancedDataService.createOrganization(orgData);
  }

  /**
   * Get organization data (maintains existing API contract)
   */
  async getOrganizationData(orgId: string): Promise<{
    inventory: any[];
    users: any[];
    activityLogs: any[];
    settings?: any;
  }> {
    try {
      const data = await enhancedDataService.getOrganizationData(orgId);
      
      // Convert to existing format for backward compatibility
      const transformedData = {
        inventory: data.inventory.map(item => this.transformInventoryItem(item)),
        users: data.users.map(user => this.transformUser(user)),
        activityLogs: data.activityLogs.map(log => this.transformActivityLog(log)),
        settings: data.settings
      };

      return transformedData;
    } catch (error) {
      console.error('❌ Error getting organization data:', error);
      throw error;
    }
  }

  /**
   * Add inventory item (enhanced structure)
   */
  async addInventoryItem(orgId: string, itemData: {
    name: string;
    description?: string;
    category?: string;
    quantity: number;
    price?: number;
    cost?: number;
    minThreshold?: number;
    createdBy: string;
  }): Promise<string> {
    return enhancedDataService.addInventoryItem(orgId, itemData);
  }

  /**
   * Update inventory item (enhanced with activity logging)
   */
  async updateInventoryItem(orgId: string, itemId: string, updates: any, userId: string): Promise<void> {
    // Handle stock updates specially for proper activity logging
    if ('quantity' in updates) {
      await enhancedDataService.updateItemStock(orgId, itemId, updates.quantity, userId);
    }
    
    // Handle other updates here if needed
    // For now, focusing on stock updates as that's the main activity source
  }

  /**
   * Add activity log (enhanced structure)
   */
  async addLogAPI(logEntry: {
    user: string;
    action: string;
    details?: any;
  }, orgId: string): Promise<void> {
    try {
      // Convert old format to enhanced structure
      const enhancedLog = {
        action: {
          type: this.categorizeAction(logEntry.action),
          description: logEntry.action,
          category: this.getActionCategory(logEntry.action)
        },
        user: {
          id: logEntry.user,
          name: logEntry.user,
          role: 'user' // Will be resolved from context
        },
        target: {
          type: 'general',
          id: 'system',
          name: 'System Action'
        },
        changes: {
          field: 'action',
          from: null,
          to: logEntry.action,
          metadata: logEntry.details || {}
        },
        audit: {
          timestamp: new Date().toISOString(),
          source: 'dashboard',
          deviceId: `dashboard_${Date.now()}`,
          ip: null
        }
      };

      await enhancedDataService.addActivityLog(orgId, enhancedLog);

      // Also add to realtime for live updates (APK logs only)
      if (this.isAPKLog(logEntry)) {
        await enhancedDataService.addRealtimeActivity(orgId, {
          userId: logEntry.user,
          action: logEntry.action,
          source: 'apk',
          timestamp: new Date().toISOString(),
          deviceId: `apk_${Date.now()}`
        });
      }
    } catch (error) {
      console.error('❌ Error adding log:', error);
      throw error;
    }
  }

  /**
   * Add user to organization (enhanced structure)
   */
  async addUserToOrganization(orgId: string, userData: {
    uid: string;
    name: string;
    email: string;
    role: string;
  }): Promise<void> {
    return enhancedDataService.addUserToOrganization(orgId, userData);
  }

  /**
   * Start real-time activity listener
   */
  startRealtimeActivityListener(orgId: string, callback: (activity: any) => void): void {
    enhancedDataService.startRealtimeActivityListener(orgId, callback);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    enhancedDataService.cleanup();
  }

  // =====================================
  // TRANSFORMATION HELPERS
  // =====================================

  /**
   * Transform enhanced inventory item to legacy format
   */
  private transformInventoryItem(item: any): any {
    return {
      id: item.id,
      name: item.details?.name || 'Unknown',
      description: item.details?.description || '',
      category: item.details?.category || 'General',
      quantity: item.stock?.quantity || 0,
      price: item.pricing?.price || 0,
      cost: item.pricing?.cost || 0,
      minThreshold: item.stock?.minThreshold || 5,
      maxThreshold: item.stock?.maxThreshold || 100,
      supplier: item.details?.supplier || '',
      // Legacy compatibility
      qrCode: item.details?.barcode || null,
      lowStock: (item.stock?.quantity || 0) <= (item.stock?.minThreshold || 0),
      createdAt: item.metadata?.createdAt,
      updatedAt: item.metadata?.updatedAt
    };
  }

  /**
   * Transform enhanced user to legacy format
   */
  private transformUser(user: any): any {
    return {
      id: user.id,
      uid: user.id,
      name: user.profile?.name || 'Unknown',
      email: user.profile?.email || '',
      role: user.profile?.role || 'user',
      permissions: user.profile?.permissions || [],
      lastLogin: user.activity?.lastLogin,
      active: user.metadata?.status === 'active',
      // Legacy compatibility
      organizationId: user.metadata?.organizationId
    };
  }

  /**
   * Transform enhanced activity log to legacy format
   */
  private transformActivityLog(log: any): any {
    return {
      id: log.id,
      user: log.user?.name || log.user?.id || 'Unknown',
      action: log.action?.description || 'Unknown action',
      details: log.changes?.metadata || log.target?.name || 'No details',
      timestamp: log.audit?.timestamp || new Date().toISOString(),
      // Enhanced data available if needed
      _enhanced: {
        actionType: log.action?.type,
        category: log.action?.category,
        target: log.target,
        changes: log.changes,
        source: log.audit?.source,
        deviceId: log.audit?.deviceId
      }
    };
  }

  /**
   * Categorize action type
   */
  private categorizeAction(action: string): string {
    if (action.includes('stock') || action.includes('inventory')) return 'stock_update';
    if (action.includes('user') || action.includes('profile')) return 'user_management';
    if (action.includes('login') || action.includes('auth')) return 'authentication';
    if (action.includes('sync') || action.includes('import')) return 'data_sync';
    return 'general';
  }

  /**
   * Get action category
   */
  private getActionCategory(action: string): string {
    if (action.includes('inventory') || action.includes('stock')) return 'inventory';
    if (action.includes('user')) return 'user_management';
    if (action.includes('auth') || action.includes('login')) return 'authentication';
    if (action.includes('sync') || action.includes('zoho') || action.includes('import')) return 'integration';
    return 'general';
  }

  /**
   * Check if log is from APK
   */
  private isAPKLog(logEntry: any): boolean {
    const action = logEntry.action?.toLowerCase() || '';
    const details = JSON.stringify(logEntry.details || '').toLowerCase();
    
    return (
      details.includes('apk') ||
      details.includes('realtime') ||
      logEntry.user?.length > 20 ||
      action.includes('stock out:') ||
      action.includes('stock in:')
    );
  }
}

export const enhancedAPI = new EnhancedAPIService();