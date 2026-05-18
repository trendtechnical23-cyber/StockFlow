/**
 * Direct Notification Service
 * 
 * Sends notifications immediately after actions occur
 * NO FIRESTORE LISTENERS - reduces quota usage by 95%+
 */

import { firestoreService, NotificationDoc } from './firestoreService';
import { getDatabase, ref, set, push } from 'firebase/database';

export interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: any;
}

export class DirectNotificationService {
  private static instance: DirectNotificationService;
  
  static getInstance(): DirectNotificationService {
    if (!DirectNotificationService.instance) {
      DirectNotificationService.instance = new DirectNotificationService();
    }
    return DirectNotificationService.instance;
  }

  /**
   * Send notification to specific user
   */
  async sendToUser(orgId: string, notification: NotificationPayload): Promise<void> {
    try {
      // Write to Firestore for persistence and web dashboard
      await firestoreService.createNotification(orgId, {
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data,
      } as any);
      
      // Write to Realtime Database for instant APK delivery
      const database = getDatabase();
      const notificationRef = ref(database, `organizations/${orgId}/notifications/${notification.userId}`);
      const newNotificationRef = push(notificationRef);
      
      await set(newNotificationRef, {
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data || {},
        timestamp: Date.now()
      });
      
      console.log(`✅ Notification sent to user ${notification.userId}`);
    } catch (error) {
      console.error('❌ Error sending notification:', error);
    }
  }

  /**
   * Send notification to all managers in org
   */
  async sendToManagers(orgId: string, notification: Omit<NotificationPayload, 'userId'>): Promise<void> {
    try {
      const members = await firestoreService.getMembers(orgId);
      const managers = members.filter(m => m.role === 'owner' || m.role === 'manager');
      
      const promises = managers.map(manager =>
        this.sendToUser(orgId, {
          ...notification,
          userId: manager.userId
        })
      );
      
      await Promise.all(promises);
      console.log(`✅ Notification sent to ${managers.length} managers`);
    } catch (error) {
      console.error('❌ Error sending notification to managers:', error);
    }
  }

  /**
   * Send notification to all staff (including managers)
   */
  async sendToAllStaff(orgId: string, notification: Omit<NotificationPayload, 'userId'>): Promise<void> {
    try {
      const members = await firestoreService.getMembers(orgId);
      
      const promises = members.map(member =>
        this.sendToUser(orgId, {
          ...notification,
          userId: member.userId
        })
      );
      
      await Promise.all(promises);
      console.log(`✅ Notification sent to ${members.length} staff members`);
    } catch (error) {
      console.error('❌ Error sending notification to staff:', error);
    }
  }

  /**
   * Notify managers about pending change request
   */
  async notifyPendingChange(
    orgId: string,
    itemName: string,
    changeType: string,
    requestedByName: string
  ): Promise<void> {
    await this.sendToManagers(orgId, {
      type: 'pending_change',
      title: 'Approval Required',
      message: `${requestedByName} requested ${changeType} for ${itemName}`,
      data: { itemName, changeType, requestedByName }
    });
  }

  /**
   * Notify requester about approval/rejection
   */
  async notifyChangeReviewed(
    orgId: string,
    userId: string,
    itemName: string,
    approved: boolean,
    reviewerName: string,
    notes?: string
  ): Promise<void> {
    await this.sendToUser(orgId, {
      userId,
      type: approved ? 'change_approved' : 'change_rejected',
      title: approved ? 'Change Approved' : 'Change Rejected',
      message: `Your request for ${itemName} was ${approved ? 'approved' : 'rejected'} by ${reviewerName}${notes ? ': ' + notes : ''}`,
      data: { itemName, approved, reviewerName, notes }
    });
  }

  /**
   * Notify about low stock
   */
  async notifyLowStock(orgId: string, itemName: string, currentQuantity: number): Promise<void> {
    await this.sendToManagers(orgId, {
      type: 'low_stock',
      title: 'Low Stock Alert',
      message: `${itemName} is running low (${currentQuantity} remaining)`,
      data: { itemName, currentQuantity }
    });
  }

  /**
   * Notify about inventory changes
   */
  async notifyInventoryChange(
    orgId: string,
    itemName: string,
    action: string,
    userName: string
  ): Promise<void> {
    await this.sendToAllStaff(orgId, {
      type: 'inventory_change',
      title: 'Inventory Updated',
      message: `${userName} ${action} ${itemName}`,
      data: { itemName, action, userName }
    });
  }
}

export const directNotificationService = DirectNotificationService.getInstance();
