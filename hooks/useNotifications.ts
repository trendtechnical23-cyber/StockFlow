import { useEffect, useCallback, useState } from 'react';
import notificationService, { Notification } from '../services/notificationService';
import { useAppContext } from '../context/AppContext';

export interface NotificationHookReturn {
  // Notification state
  notifications: Notification[];
  unreadCount: number;
  isSessionActive: boolean;
  
  // Notification actions
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

/**
 * Hook for Firestore-only notifications
 * NO Realtime Database - 100% Firestore
 */
export function useNotifications(): NotificationHookReturn {
  const { state } = useAppContext();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Derive isSessionActive from notifications: any session that has STARTED but not ENDED
  const startedIds = new Set(
    notifications
      .filter(n => n.type === 'stock_take_session' && (n as any).eventType === 'STARTED')
      .map(n => (n as any).sessionId)
  );
  const endedIds = new Set(
    notifications
      .filter(n => n.type === 'stock_take_session' && (n as any).eventType === 'ENDED')
      .map(n => (n as any).sessionId)
  );
  const isSessionActive = [...startedIds].some(id => !endedIds.has(id));

  // Subscribe to notifications
  useEffect(() => {
    if (!state.currentOrganization?.id || !state.currentUser?.uid) {
      console.log('⚠️ Notifications: Missing organization or user ID');
      return;
    }

    console.log('🔔 Setting up notification subscription for:', {
      orgId: state.currentOrganization.id,
      userId: state.currentUser.uid
    });

    const unsubscribe = notificationService.subscribeToNotifications(
      state.currentOrganization.id,
      state.currentUser.uid,
      (newNotifications) => {
        console.log('🔔 Notifications updated:', newNotifications.length, 'total');
        setNotifications(newNotifications);
        const unreadCount = newNotifications.filter(n => !n.read).length;
        setUnreadCount(unreadCount);
        console.log('🔔 Unread count:', unreadCount);
      }
    );

    return () => {
      console.log('🔔 Cleaning up notification subscription');
      unsubscribe();
    };
  }, [state.currentOrganization?.id, state.currentUser?.uid]);

  const markAsRead = useCallback(async (id: string) => {
    if (!state.currentOrganization?.id || !state.currentUser?.uid) return;
    
    await notificationService.markAsRead(state.currentOrganization.id, id, state.currentUser.uid);
  }, [state.currentOrganization?.id, state.currentUser?.uid]);

  const markAllAsRead = useCallback(async () => {
    if (!state.currentOrganization?.id || !state.currentUser?.uid) return;
    
    await notificationService.markAllAsRead(state.currentOrganization.id, state.currentUser.uid);
  }, [state.currentOrganization?.id, state.currentUser?.uid]);

  return {
    notifications,
    unreadCount,
    isSessionActive,
    markAsRead,
    markAllAsRead,
  };
}

export default useNotifications;
