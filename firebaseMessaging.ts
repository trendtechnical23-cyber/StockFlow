/**
 * Firebase Cloud Messaging — DISABLED
 *
 * The Firebase project was deleted during the migration to Supabase.
 * Push notifications are not available until FCM is re-provisioned on a new
 * Firebase project (or replaced with an alternative web-push provider).
 *
 * Every export below is a safe no-op so the rest of the app can call these
 * without throwing. In-app notifications still work via Supabase
 * (see services/notificationService.ts and the notifications table).
 */

export const initializeMessaging = async (): Promise<void> => {
  // no-op: FCM disabled (Firebase project removed)
};

export const requestFCMPermission = async (): Promise<string | null> => {
  return null;
};

export const setupFCMForUser = async (): Promise<void> => {
  // no-op
};

export const isFCMSupported = (): boolean => false;

export const getNotificationPermission = (): NotificationPermission =>
  typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default';

export const messaging = null;
