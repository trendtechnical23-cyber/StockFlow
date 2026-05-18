import { serverTimestamp } from 'firebase/firestore';
import { auth } from './firebase';
import { addLogAPI } from './apiService';

/**
 * Comprehensive activity logger for audit trail
 * Logs all user actions for accountability and compliance
 */

export interface ActivityLogData {
  action: string;
  category: 'USER_MANAGEMENT' | 'ORGANIZATION' | 'INVENTORY' | 'SETTINGS' | 'AUTHENTICATION' | 'SYSTEM';
  description: string;
  targetType?: 'user' | 'organization' | 'item' | 'setting' | 'role';
  targetId?: string;
  targetName?: string;
  previousValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
}

class ActivityLogger {
  /**
   * Log any dashboard activity with full context
   */
  async log(organizationId: string, data: ActivityLogData): Promise<void> {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.warn('⚠️ Cannot log activity - no current user');
        return;
      }

      const logEntry = {
        // Dashboard format fields
        action: data.action || 'Unknown Action',
        category: data.category,
        description: data.description || 'No description available',
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email || 'Unknown User',
        userRole: 'user', // Default role - could be enhanced
        targetType: data.targetType || null,
        targetId: data.targetId || null,
        targetName: data.targetName || null,
        // Ensure previousValue and newValue are never undefined
        previousValue: data.previousValue !== undefined ? data.previousValue : null,
        newValue: data.newValue !== undefined ? data.newValue : null,
        
        // APK compatible fields (for unified format)
        user: currentUser.displayName || currentUser.email || 'Unknown User', // APK expects 'user' field
        orgId: organizationId, // APK format
        organizationId: organizationId, // Dashboard format
        timestamp: new Date().toISOString(), // APK format
        source: 'dashboard', // APK compatibility
        itemId: data.targetId, // APK format
        itemName: data.targetName, // APK format
        
        metadata: {
          ...data.metadata,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          sessionId: sessionStorage.getItem('sessionId') || 'unknown',
          // APK compatibility metadata
          importSource: 'dashboard'
        }
      };

      await addLogAPI(logEntry, organizationId);
      console.log('📋 Activity logged:', data.action);
      
      // Broadcast notification for APK integration
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('stockflow-activity');
        channel.postMessage({
          type: 'NEW_ACTIVITY',
          activity: {
            orgId: organizationId,
            userId: currentUser.uid,
            action: data.action,
            itemId: data.targetId,
            itemName: data.targetName,
            timestamp: new Date().toISOString(),
            source: 'dashboard'
          }
        });
        channel.close();
      }
    } catch (error) {
      console.error('❌ Failed to log activity:', error);
      // Don't throw - logging failures shouldn't break the main operation
    }
  }

  // Specific logging methods for common operations
  async logUserCreation(organizationId: string, userEmail: string, role: string, createdBy: string) {
    await this.log(organizationId, {
      action: 'Created New User',
      category: 'USER_MANAGEMENT',
      description: userEmail,
      targetType: 'user',
      targetId: userEmail, // Use email as targetId to prevent undefined error
      targetName: userEmail,
      newValue: { email: userEmail, role },
      metadata: { createdBy }
    });
  }

  async logUserDeletion(organizationId: string, userEmail: string, deletedBy: string) {
    await this.log(organizationId, {
      action: 'DELETE_USER',
      category: 'USER_MANAGEMENT',
      description: `Deleted user: ${userEmail}`,
      targetType: 'user',
      targetId: userEmail,
      targetName: userEmail,
      previousValue: null, // Set to null instead of undefined
      newValue: null, // Ensure newValue is also safe
      metadata: { deletedBy, reason: 'User removal from organization' }
    });
  }

  async logRoleChange(organizationId: string, userEmail: string, oldRole: string, newRole: string) {
    await this.log(organizationId, {
      action: 'CHANGE_USER_ROLE',
      category: 'USER_MANAGEMENT',
      description: `Changed ${userEmail} role from ${oldRole} to ${newRole}`,
      targetType: 'user',
      targetName: userEmail,
      previousValue: oldRole,
      newValue: newRole
    });
  }

  async logNameChange(organizationId: string, targetType: 'user' | 'organization', targetName: string, oldName: string, newName: string) {
    await this.log(organizationId, {
      action: targetType === 'user' ? 'CHANGE_USER_NAME' : 'CHANGE_ORGANIZATION_NAME',
      category: targetType === 'user' ? 'USER_MANAGEMENT' : 'ORGANIZATION',
      description: `Changed ${targetType} name from "${oldName}" to "${newName}"`,
      targetType,
      targetName: targetType === 'user' ? targetName : organizationId,
      previousValue: oldName,
      newValue: newName
    });
  }

  async logOrganizationCreation(organizationId: string, organizationName: string) {
    await this.log(organizationId, {
      action: 'CREATE_ORGANIZATION',
      category: 'ORGANIZATION',
      description: `Created new organization: ${organizationName}`,
      targetType: 'organization',
      targetId: organizationId,
      targetName: organizationName,
      newValue: { name: organizationName }
    });
  }

  async logSettingChange(organizationId: string, settingName: string, oldValue: any, newValue: any) {
    await this.log(organizationId, {
      action: 'CHANGE_SETTING',
      category: 'SETTINGS',
      description: `Changed setting "${settingName}" from ${JSON.stringify(oldValue)} to ${JSON.stringify(newValue)}`,
      targetType: 'setting',
      targetName: settingName,
      previousValue: oldValue,
      newValue: newValue
    });
  }

  async logInventoryAction(organizationId: string, action: string, itemName: string, details?: any) {
    const description = `${action.replace(/_/g, ' ')}: ${itemName} by ${auth.currentUser?.email || 'System'}`;
    
    await this.log(organizationId, {
      action: action.replace(/_/g, ' '),
      category: 'INVENTORY',
      description: description,
      targetType: 'item',
      targetName: itemName,
      metadata: {
        ...details,
        timestamp: new Date().toISOString()
      },
      previousValue: details?.previousData || details?.initialStock,
      newValue: details?.newData || details?.finalStock
    });

    // Trigger system notification for every edit/move/delete
    try {
      const { notificationService } = await import('./notificationService');
      const currentUser = auth.currentUser;
      
      await notificationService.createNotification(organizationId, {
        type: 'stock',
        title: action.replace(/_/g, ' '),
        message: `${description} at ${new Date().toLocaleTimeString()}`,
        targetUserId: 'ALL',
        priority: (action.includes('DELETE') || action.includes('STOCK')) ? 'high' : 'normal',
        metadata: {
          itemName,
          sku: details?.sku,
          user: currentUser?.email,
          timestamp: new Date().toISOString()
        }
      });
    } catch (notifyErr) {
      console.warn('⚠️ Failed to create notification for activity:', notifyErr);
    }
  }

  async logAuthentication(organizationId: string, action: 'LOGIN' | 'LOGOUT', userEmail: string) {
    await this.log(organizationId, {
      action: action,
      category: 'AUTHENTICATION',
      description: `User ${action.toLowerCase()}: ${userEmail}`,
      targetType: 'user',
      targetName: userEmail,
      metadata: { 
        timestamp: new Date().toISOString(),
        ip: 'unknown' // Could be enhanced with IP detection
      }
    });
  }

  async logSystemEvent(organizationId: string, event: string, description: string, metadata?: any) {
    await this.log(organizationId, {
      action: event,
      category: 'SYSTEM',
      description: description,
      metadata: metadata
    });
  }

  /**
   * Test function to create a mock APK log entry (for testing formatting)
   */
  async createTestAPKLog(organizationId: string) {
    try {
      const mockAPKLog = {
        orgId: organizationId,
        userId: 'test_apk_user_123',
        action: 'Stock Out: Repair - Removed 1 units',
        itemId: 'item_repair_001',
        itemName: 'Repair Kit',
        quantity: -1,
        timestamp: new Date().toISOString(),
        source: 'apk',
        user: 'John Smith', // Real username from APK
        userName: 'John Smith' // Real username from APK
      };

      // Use Firebase addDoc directly to simulate APK log
      const { addDoc, collection } = await import('./firebase');
      const logsRef = collection(firestore, 'organizations', organizationId, 'activityLogs');
      
      await addDoc(logsRef, mockAPKLog);
      console.log('📱 Test APK log created successfully');
    } catch (error) {
      console.error('❌ Failed to create test APK log:', error);
    }
  }
}

// Export singleton instance
export const activityLogger = new ActivityLogger();