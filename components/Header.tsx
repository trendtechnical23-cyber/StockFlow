import React, { useState, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import useNotifications from '../hooks/useNotifications';
import SessionStatus from './SessionStatus';
import { BackendStatus } from './BackendStatus';
import { playNotificationSound, unlockAudio } from '../utils/notificationSounds';

const LogoutIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
);

interface HeaderProps {
  onLogout: () => void;
  isUserActive?: boolean;
}

const Header: React.FC<HeaderProps> = ({ onLogout, isUserActive = true }) => {
  const { state: { currentUser } } = useAppContext();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const displayName = currentUser?.name || currentUser?.email || 'User';

  // Unlock audio playback on first user interaction (defeats browser autoplay policy)
  useEffect(() => {
    unlockAudio();
  }, []);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  // Track which notification IDs we've already processed (sound + browser popup).
  // Seeded with all IDs present on the FIRST load so we only react to genuinely
  // new notifications, not the historical batch that arrives on mount.
  const [shownNotificationIds, setShownNotificationIds] = useState<Set<string>>(new Set());
  const initialLoadDone = useRef(false);

  // Play sound and show browser notification when new notifications arrive
  useEffect(() => {
    if (notifications.length === 0) return;

    // On first load: silently seed the set with all existing IDs so we don't
    // play sounds for notifications the user already received earlier.
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      const existingIds = new Set(
        notifications.map(n => n.id).filter(Boolean) as string[]
      );
      setShownNotificationIds(existingIds);
      return; // Don't play anything for the initial batch
    }

    const latestNotification = notifications[0];

    // Only act on genuinely new, unread notifications
    if (
      !latestNotification.read &&
      latestNotification.id &&
      !shownNotificationIds.has(latestNotification.id)
    ) {
      // Mark as processed immediately to prevent double-play on re-render
      setShownNotificationIds(prev => new Set(prev).add(latestNotification.id!));

      // Resolve the sound type, with sub-event support for stock_take_session
      const notifType  = (latestNotification as any).type ?? 'general';
      // metadata.eventType for AppContext notifications; top-level eventType for APK Firestore notifications
      const eventType  = (latestNotification as any).metadata?.eventType
                      ?? (latestNotification as any).eventType as string | undefined;

      playNotificationSound(notifType, eventType);
      console.log('🔔 New notification sound:', notifType, eventType ?? '', '—', latestNotification.title);

      // Browser OS notification popup.
      // silent: true suppresses the OS default sound so ONLY our custom
      // playNotificationSound() audio is heard (otherwise they'd double up,
      // or the OS sound would mask the custom one).
      if ('Notification' in window) {
        const show = () => new Notification(latestNotification.title, {
          body  : latestNotification.message,
          icon  : '/favicon.ico',
          badge : '/favicon.ico',
          tag   : latestNotification.id,
          silent: true,
        });

        if (Notification.permission === 'granted') {
          show();
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(p => { if (p === 'granted') show(); });
        }
      }
    }
  }, [notifications, shownNotificationIds]);

  const handleNotificationClick = async (notification: any) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    setShowNotifications(false);
  };

  const formatTimeAgo = (timestamp: any) => {
    const now = new Date();
    const time = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    const diffMs = now.getTime() - time.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
  };

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 h-16 flex justify-between items-center z-50 shadow-sm">
      <div className="flex items-center gap-3">
        {/* Logo mark */}

      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:block text-sm text-gray-500 dark:text-gray-400">
          Hello, {displayName}
        </span>
        
        {/* Notification Bell */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          
          {/* Notification Dropdown */}
          {showNotifications && (
            <>
              {/* Invisible backdrop to close on outside click */}
              <div className="fixed inset-0 z-[59]" onClick={() => setShowNotifications(false)} />
              <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-[60] overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/80">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notifications</h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={() => markAllAsRead()}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="py-10 text-center">
                      <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                      <p className="text-sm text-gray-500 dark:text-gray-400">All caught up!</p>
                    </div>
                  ) : (
                    notifications.slice(0, 10).map((notification) => (
                      <div
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={`px-4 py-3 border-b border-gray-50 dark:border-gray-700/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                          !notification.read ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                              {notification.title}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                              {formatTimeAgo(notification.createdAt)}
                            </p>
                          </div>
                          {!notification.read && (
                            <div className="w-2 h-2 bg-indigo-500 rounded-full flex-shrink-0 mt-1.5"></div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        
        <BackendStatus />
        <SessionStatus isActive={isUserActive} />
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900 transition-all shadow-sm"
        >
          <LogoutIcon />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};

export default Header;