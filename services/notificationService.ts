/**
 * Notification Service v2
 *
 * Schema: notification_events + notification_recipients (split tables)
 *
 * notification_events   — the event itself (one row per occurrence)
 * notification_recipients — per-user delivery state (is_read, push_sent, etc.)
 *
 * Queries join both tables so callers get a flat Notification shape.
 * Realtime subscribes to notification_recipients (user-scoped inserts).
 *
 * Backward-compat: exports the same Notification interface and
 * NotificationService class API as v1 so all existing callers work unchanged.
 */

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type NotificationType =
  | 'approval_pending'
  | 'approval_approved'
  | 'approval_rejected'
  | 'stock_adjustment_applied'
  | 'low_stock'
  | 'stock_take_approved'
  | 'system'
  | 'user'
  | string;

export interface Notification {
  id:           string;   // notification_recipients.id
  eventId:      string;   // notification_events.id
  type:         NotificationType;
  title:        string;
  message:      string;
  read:         boolean;
  pushSent:     boolean;
  createdAt:    string;
  data:         Record<string, any>;
  // kept for backward compat
  targetUserId: string;
  priority:     'high' | 'normal';
  metadata:     Record<string, any>;
}

const HIGH_PRIORITY_TYPES = new Set([
  'approval_pending', 'low_stock', 'approval_approved', 'approval_rejected'
]);

function rowToNotification(row: any): Notification {
  const event = row.notification_events ?? row.event ?? {};
  return {
    id:           row.id,
    eventId:      row.event_id,
    type:         event.type ?? row.type ?? 'system',
    title:        event.title ?? row.title ?? '',
    message:      event.body  ?? row.body  ?? '',
    read:         !!row.is_read,
    pushSent:     !!row.push_sent,
    createdAt:    event.created_at ?? row.created_at,
    data:         event.data  ?? row.data ?? {},
    // backward compat
    targetUserId: row.user_id ?? 'ALL',
    priority:     HIGH_PRIORITY_TYPES.has(event.type) ? 'high' : 'normal',
    metadata:     event.data ?? {},
  };
}

class NotificationService {
  private activeChannel: RealtimeChannel | null = null;
  private activeKey: string | null = null;
  private callbacks: Set<(n: Notification[]) => void> = new Set();
  private lastNotifications: Notification[] = [];

  // ── Subscribe ──────────────────────────────────────────────────

  subscribeToNotifications(
    organizationId: string,
    userId: string,
    onUpdate: (notifications: Notification[]) => void,
    maxCount = 50
  ): () => void {
    const key = `${organizationId}_${userId}`;

    const fetchAll = async () => {
      try {
        const { data, error } = await supabase
          .from('notification_recipients')
          .select(`
            id, event_id, user_id, is_read, push_sent, created_at,
            notification_events!inner (
              id, org_id, type, title, body, data, created_at
            )
          `)
          .eq('user_id', userId)
          .eq('notification_events.org_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(maxCount);

        if (error) throw error;
        const notifications = (data ?? []).map(r => rowToNotification(r));
        this.lastNotifications = notifications;
        this.callbacks.forEach(cb => cb(notifications));
      } catch (err) {
        console.error('❌ Failed to fetch notifications:', err);
        this.callbacks.forEach(cb => cb([]));
      }
    };

    this.callbacks.add(onUpdate);

    if (this.activeKey === key && this.activeChannel) {
      onUpdate(this.lastNotifications);
    } else {
      if (this.activeChannel) {
        supabase.removeChannel(this.activeChannel);
        this.activeChannel = null;
      }
      this.activeKey = key;
      this.lastNotifications = [];

      fetchAll();

      const channelName = `notif_recipients:${key}`;
      this.activeChannel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notification_recipients',
            filter: `user_id=eq.${userId}`,
          },
          () => fetchAll()
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`🔔 Notification channel active for user ${userId}`);
          }
        });
    }

    return () => {
      this.callbacks.delete(onUpdate);
      if (this.callbacks.size === 0 && this.activeChannel) {
        supabase.removeChannel(this.activeChannel);
        this.activeChannel = null;
        this.activeKey = null;
        this.lastNotifications = [];
      }
    };
  }

  // ── Mark read ──────────────────────────────────────────────────

  async markAsRead(_organizationId: string, notificationId: string, _userId: string): Promise<void> {
    const { error } = await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', notificationId);
    if (error) throw error;
  }

  async markAllAsRead(organizationId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) throw error;
  }

  // ── Unread count ───────────────────────────────────────────────

  async getUnreadCount(organizationId: string, userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('notification_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) return 0;
    return count ?? 0;
  }

  // ── Convenience helpers (backward compat) ──────────────────────

  async notifyApproval(organizationId: string, targetUserId: string, itemName: string, approvalId: string): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'approval_pending',
      title: '🔔 Approval Required',
      message: `Stock change for "${itemName}" requires your approval`,
      targetUserId,
      priority: 'high',
    });
  }

  async notifyLowStock(organizationId: string, managerUserIds: string[], itemName: string, currentStock: number): Promise<void> {
    // Use RPC broadcast to all managers
    const { error } = await supabase.rpc('fn_notify_managers', {
      p_org_id: organizationId,
      p_type:   'low_stock',
      p_title:  '⚠️ Low Stock Alert',
      p_body:   `${itemName} is low on stock (${currentStock} remaining)`,
      p_data:   { itemName, currentStock },
    });
    if (error) console.error('❌ Low stock notification failed:', error.message);
  }

  async notifyUser(organizationId: string, targetUserId: string, title: string, message: string): Promise<void> {
    await this.createNotification(organizationId, {
      type: 'user',
      title,
      message,
      targetUserId,
      priority: 'normal',
    });
  }

  /** @deprecated Internal helper — prefer calling fn_notify_users RPC from backend */
  async createNotification(
    organizationId: string,
    notification: { type: string; title: string; message: string; targetUserId: string; priority: 'high' | 'normal'; data?: Record<string, any> }
  ): Promise<void> {
    // Insert event
    const { data: event, error: eventErr } = await supabase
      .from('notification_events')
      .insert({
        org_id: organizationId,
        type:   notification.type,
        title:  notification.title,
        body:   notification.message,
        data:   notification.data ?? {},
      })
      .select('id')
      .single();

    if (eventErr) { console.error('❌ Failed to create notification event:', eventErr.message); return; }

    // Insert recipient row
    const { error: recipErr } = await supabase
      .from('notification_recipients')
      .insert({
        event_id: event.id,
        org_id:   organizationId,
        user_id:  notification.targetUserId,
      });

    if (recipErr) console.error('❌ Failed to create notification recipient:', recipErr.message);
  }

  unsubscribeAll(): void {
    if (this.activeChannel) {
      supabase.removeChannel(this.activeChannel);
      this.activeChannel = null;
    }
    this.callbacks.clear();
  }
}

export const notificationService = new NotificationService();
export default notificationService;
