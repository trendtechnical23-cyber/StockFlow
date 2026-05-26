/**
 * Supabase Notification Service (replaces the old Firestore implementation)
 *
 * Table: public.notifications
 *   id, org_id, user_id, title, body, type, data (jsonb), is_read, created_at
 *
 * Model notes (Firestore → Supabase):
 *   - targetUserId 'ALL'  → user_id = NULL  (org-wide broadcast)
 *   - targetUserId <uid>  → user_id = <uid> (direct)
 *   - read/readBy[]       → is_read (boolean per row)
 *   - message             → body
 *   - metadata            → data (jsonb)
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type NotificationType = 'approval' | 'stock' | 'system' | 'low_stock' | 'user' | 'stock_take_session';

export interface Notification {
  id?: string;
  type: NotificationType;
  title: string;
  message: string;
  targetUserId: string | 'ALL';
  createdAt: Date | string;
  read: boolean;
  link?: string;
  priority: 'high' | 'normal';
  metadata?: Record<string, any>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map a Supabase notifications row to the app's Notification shape */
const rowToNotification = (row: any, userId: string): Notification => ({
  id: row.id,
  type: row.type,
  title: row.title,
  message: row.body ?? '',
  targetUserId: row.user_id ?? 'ALL',
  createdAt: row.created_at,
  read: !!row.is_read,
  priority: row.data?.priority ?? 'normal',
  link: row.data?.link,
  metadata: row.data ?? {},
  // surface common metadata fields at top level (used by useNotifications)
  ...(row.data?.eventType ? { eventType: row.data.eventType } : {}),
  ...(row.data?.sessionId ? { sessionId: row.data.sessionId } : {}),
}) as Notification;

class NotificationService {
  private channels: Map<string, RealtimeChannel> = new Map();

  /** Create a notification */
  async createNotification(
    organizationId: string,
    notification: Omit<Notification, 'id' | 'createdAt' | 'read'>
  ): Promise<string> {
    try {
      const targetIsUser = notification.targetUserId && notification.targetUserId !== 'ALL'
        && UUID_RE.test(notification.targetUserId);

      const { data, error } = await supabase
        .from('notifications')
        .insert({
          org_id:  organizationId,
          user_id: targetIsUser ? notification.targetUserId : null,
          title:   notification.title,
          body:    notification.message,
          type:    notification.type,
          data: {
            priority: notification.priority,
            link: notification.link,
            ...(notification.metadata ?? {}),
          },
          is_read: false,
        })
        .select('id')
        .single();

      if (error) throw error;
      console.log('✅ Notification created:', data.id);
      return data.id;
    } catch (error) {
      console.error('❌ Failed to create notification:', error);
      throw error;
    }
  }

  /** Subscribe to a user's notifications (direct + org broadcasts) in real time */
  subscribeToNotifications(
    organizationId: string,
    userId: string,
    onUpdate: (notifications: Notification[]) => void,
    maxCount: number = 50
  ): () => void {
    const fetchAll = async () => {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('org_id', organizationId)
          .or(`user_id.eq.${userId},user_id.is.null`)
          .order('created_at', { ascending: false })
          .limit(maxCount);

        if (error) throw error;
        const notifications = (data ?? []).map(r => rowToNotification(r, userId));
        console.log(`📬 Received ${notifications.length} notifications for user ${userId}`);
        onUpdate(notifications);
      } catch (error) {
        console.error('❌ Failed to fetch notifications:', error);
        onUpdate([]);
      }
    };

    // Initial load
    fetchAll();

    // Live updates
    const key = `${organizationId}_${userId}`;
    const channel = supabase
      .channel(`notifications:${key}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `org_id=eq.${organizationId}` },
        () => { fetchAll(); })
      .subscribe();

    this.channels.set(key, channel);

    return () => {
      const ch = this.channels.get(key);
      if (ch) { supabase.removeChannel(ch); this.channels.delete(key); }
    };
  }

  /** Mark a single notification as read */
  async markAsRead(_organizationId: string, notificationId: string, _userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);
      if (error) throw error;
    } catch (error) {
      console.error('❌ Failed to mark notification as read:', error);
      throw error;
    }
  }

  /** Mark all of a user's notifications as read */
  async markAllAsRead(organizationId: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('org_id', organizationId)
        .or(`user_id.eq.${userId},user_id.is.null`)
        .eq('is_read', false);
      if (error) throw error;
    } catch (error) {
      console.error('❌ Failed to mark all as read:', error);
      throw error;
    }
  }

  /** Unread count for a user */
  async getUnreadCount(organizationId: string, userId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', organizationId)
        .or(`user_id.eq.${userId},user_id.is.null`)
        .eq('is_read', false);
      if (error) throw error;
      return count ?? 0;
    } catch (error) {
      console.error('❌ Failed to get unread count:', error);
      return 0;
    }
  }

  unsubscribeAll(): void {
    this.channels.forEach(ch => supabase.removeChannel(ch));
    this.channels.clear();
  }

  // ── Convenience helpers ───────────────────────────────────────────────
  async notifyApproval(organizationId: string, targetUserId: string, itemName: string, approvalId: string): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'approval', title: 'Approval Request',
      message: `Stock change for "${itemName}" requires your approval`,
      targetUserId, link: `/approvals/${approvalId}`, priority: 'high',
    });
  }

  async notifyLowStock(organizationId: string, managerUserIds: string[], itemName: string, currentStock: number): Promise<void> {
    await Promise.all(managerUserIds.map(managerId =>
      this.createNotification(organizationId, {
        type: 'low_stock', title: 'Low Stock Alert',
        message: `${itemName} is low on stock (${currentStock} remaining)`,
        targetUserId: managerId, link: '/inventory', priority: 'high',
        metadata: { itemName, currentStock },
      })
    ));
  }

  async notifySystem(organizationId: string, title: string, message: string): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'system', title, message, targetUserId: 'ALL', priority: 'normal',
    });
  }

  async notifyUser(organizationId: string, targetUserId: string, title: string, message: string, link?: string): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'user', title, message, targetUserId, link, priority: 'normal',
    });
  }
}

export const notificationService = new NotificationService();
export default notificationService;
