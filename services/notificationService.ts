/**
 * Firestore-only Notification Service
 * 100% Firestore - NO Realtime Database
 * 
 * Architecture:
 * - Per organization: /organizations/{orgId}/notifications/{notificationId}
 * - Real-time listeners for live updates
 * - Persistent history
 * - Secure, queryable, offline-capable
 */

import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp,
  getDocs,
  arrayUnion
} from 'firebase/firestore';
import { firestore } from './firebase';

export type NotificationType = 'approval' | 'stock' | 'system' | 'low_stock' | 'user';

export interface Notification {
  id?: string;
  type: NotificationType;
  title: string;
  message: string;
  targetUserId: string | 'ALL'; // specific user or broadcast to all
  createdAt: Timestamp | Date;
  read: boolean; // Virtual field calculated on client
  readBy?: string[]; // Array of UIDs who have read this
  readAt?: Timestamp | Date;
  link?: string; // Deep link to relevant page
  priority: 'high' | 'normal';
  metadata?: Record<string, any>; // Additional context
}

class NotificationService {
  private unsubscribers: Map<string, () => void> = new Map();

  /**
   * Create a notification (admin/system only)
   */
  async createNotification(
    organizationId: string,
    notification: Omit<Notification, 'id' | 'createdAt' | 'read'>
  ): Promise<string> {
    if (!firestore) throw new Error('Firestore not initialized');

    try {
      const notificationsRef = collection(
        firestore,
        'organizations',
        organizationId,
        'notifications'
      );

      const docRef = await addDoc(notificationsRef, {
        ...notification,
        createdAt: serverTimestamp(),
        readBy: [], 
      });

      console.log('✅ Notification created:', docRef.id);
      
      // Broadcast to APK for real-time push notifications with deduplication key
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('stockflow-notifications');
        channel.postMessage({
          type: 'NEW_NOTIFICATION',
          orgId: organizationId,
          notificationId: docRef.id, // Add unique ID for deduplication
          notification: {
            id: docRef.id,
            title: notification.title,
            message: notification.message,
            type: notification.type,
            targetUserId: notification.targetUserId,
            priority: notification.priority,
            timestamp: new Date().toISOString()
          }
        });
        channel.close();
        console.log('📡 Notification broadcasted to APK:', notification.title, 'ID:', docRef.id);
      }
      
      return docRef.id;
    } catch (error) {
      console.error('❌ Failed to create notification:', error);
      throw error;
    }
  }

  /**
   * Listen to user's notifications in real-time
   * Auto-updates UI when new notifications arrive
   */
  subscribeToNotifications(
    organizationId: string,
    userId: string,
    onUpdate: (notifications: Notification[]) => void,
    maxCount: number = 50
  ): () => void {
    if (!firestore) {
      console.warn('Firestore not initialized');
      return () => {};
    }

    try {
      const notificationsRef = collection(
        firestore,
        'organizations',
        organizationId,
        'notifications'
      );

      // Query for user-specific OR broadcast notifications
      const q = query(
        notificationsRef,
        where('targetUserId', 'in', [userId, 'ALL']),
        orderBy('createdAt', 'desc'),
        limit(maxCount)
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const notifications: Notification[] = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
              // Calculate read status based on whether user's ID is in readBy array
              read: (data.readBy || []).includes(userId),
            };
          }) as Notification[];

          console.log(`📬 Received ${notifications.length} notifications for user ${userId}`);
          console.log(`📬 Unread notifications: ${notifications.filter(n => !n.read).length}`);
          onUpdate(notifications);
        },
        (error) => {
          console.error('❌ Notification listener error:', error);
          // Attempt to reconnect after 3 seconds
          setTimeout(() => {
            console.log('🔄 Attempting to reconnect notification listener...');
            this.subscribeToNotifications(organizationId, userId, onUpdate, maxCount);
          }, 3000);
        }
      );

      // Store unsubscriber for cleanup
      const key = `${organizationId}_${userId}`;
      this.unsubscribers.set(key, unsubscribe);

      return unsubscribe;
    } catch (error) {
      console.error('❌ Failed to subscribe to notifications:', error);
      return () => {};
    }
  }

  /**
   * Mark notification as read
   * Users can ONLY update read status - nothing else
   */
  async markAsRead(
    organizationId: string,
    notificationId: string,
    userId: string
  ): Promise<void> {
    if (!firestore) throw new Error('Firestore not initialized');

    try {
      const notificationRef = doc(
        firestore,
        'organizations',
        organizationId,
        'notifications',
        notificationId
      );

      await updateDoc(notificationRef, {
        readBy: arrayUnion(userId),
        readAt: serverTimestamp(),
      });

      console.log('✅ Notification marked as read for user:', userId, notificationId);
    } catch (error) {
      console.error('❌ Failed to mark notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all user notifications as read
   */
  async markAllAsRead(organizationId: string, userId: string): Promise<void> {
    if (!firestore) throw new Error('Firestore not initialized');

    try {
      const notificationsRef = collection(
        firestore,
        'organizations',
        organizationId,
        'notifications'
      );

      // Get recent notifications for this user
      // We can't query for "not in readBy", so we fetch recent ones and filter in-memory
      const q = query(
        notificationsRef,
        where('targetUserId', 'in', [userId, 'ALL']),
        orderBy('createdAt', 'desc'),
        limit(100)
      );

      const snapshot = await getDocs(q);

      // Filter for notifications not yet read by this user
      const unreadDocs = snapshot.docs.filter(docSnap => {
        const data = docSnap.data();
        return !(data.readBy || []).includes(userId);
      });

      // Update all to read
      const updates = unreadDocs.map((docSnap) =>
        updateDoc(docSnap.ref, {
          readBy: arrayUnion(userId),
          readAt: serverTimestamp(),
        })
      );

      await Promise.all(updates);
      console.log(`✅ Marked ${updates.length} notifications as read for user ${userId}`);
    } catch (error) {
      console.error('❌ Failed to mark all as read:', error);
      throw error;
    }
  }

  /**
   * Get unread count (for badge)
   */
  async getUnreadCount(organizationId: string, userId: string): Promise<number> {
    if (!firestore) return 0;

    try {
      const notificationsRef = collection(
        firestore,
        'organizations',
        organizationId,
        'notifications'
      );

      const q = query(
        notificationsRef,
        where('targetUserId', 'in', [userId, 'ALL']),
        orderBy('createdAt', 'desc'),
        limit(100)
      );

      const snapshot = await getDocs(q);
      
      // Count notifications where user ID is not in readBy
      const unreadCount = snapshot.docs.filter(docSnap => {
        const data = docSnap.data();
        return !(data.readBy || []).includes(userId);
      }).length;
      
      return unreadCount;
    } catch (error) {
      console.error('❌ Failed to get unread count:', error);
      return 0;
    }
  }

  /**
   * Cleanup all listeners
   */
  unsubscribeAll(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.clear();
    console.log('✅ All notification listeners unsubscribed');
  }

  /**
   * Helper: Send approval notification
   */
  async notifyApproval(
    organizationId: string,
    targetUserId: string,
    itemName: string,
    approvalId: string
  ): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'approval',
      title: 'Approval Request',
      message: `Stock change for "${itemName}" requires your approval`,
      targetUserId,
      link: `/approvals/${approvalId}`,
      priority: 'high',
    });
  }

  /**
   * Helper: Send low stock alert
   */
  async notifyLowStock(
    organizationId: string,
    managerUserIds: string[],
    itemName: string,
    currentStock: number
  ): Promise<void> {
    // Send to all managers
    await Promise.all(
      managerUserIds.map((managerId) =>
        this.createNotification(organizationId, {
          type: 'low_stock',
          title: 'Low Stock Alert',
          message: `${itemName} is low on stock (${currentStock} remaining)`,
          targetUserId: managerId,
          link: '/inventory',
          priority: 'high',
          metadata: { itemName, currentStock },
        })
      )
    );
  }

  /**
   * Helper: Send system notification (broadcast to all)
   */
  async notifySystem(
    organizationId: string,
    title: string,
    message: string
  ): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'system',
      title,
      message,
      targetUserId: 'ALL',
      priority: 'normal',
    });
  }

  /**
   * Helper: Send user-specific notification
   */
  async notifyUser(
    organizationId: string,
    targetUserId: string,
    title: string,
    message: string,
    link?: string
  ): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'user',
      title,
      message,
      targetUserId,
      link,
      priority: 'normal',
    });
  }
}

export const notificationService = new NotificationService();
export default notificationService;
