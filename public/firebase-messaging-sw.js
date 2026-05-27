/**
 * firebase-messaging-sw.js — DISABLED
 *
 * The Firebase project was deleted during the Supabase migration.
 * This service worker is a no-op so any cached version unregisters cleanly
 * and doesn't attempt to reach the deleted Firebase backend.
 *
 * In-app notifications are handled by Supabase Realtime
 * (services/notificationService.ts → public.notifications table).
 */

// Unregister self so the browser doesn't cache a broken SW
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  self.clients.claim();
  // Tell all open tabs the SW has updated
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => client.postMessage({ type: 'SW_DISABLED' }));
  });
});
