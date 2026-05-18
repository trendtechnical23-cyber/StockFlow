// firebase-messaging-sw.js
// Service workers must use importScripts, not ES6 imports
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase configuration (MUST match your main app config)
const firebaseConfig = {
  apiKey: "AIzaSyAgXpzj4Q8JANNhj2Pz_cPItD-brfwfBpE",
  authDomain: "stockflow-dashboard-a1aa6.firebaseapp.com",
  databaseURL: "https://stockflow-dashboard-a1aa6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "stockflow-dashboard-a1aa6",
  storageBucket: "stockflow-dashboard-a1aa6.firebasestorage.app",
  messagingSenderId: "952334299306",
  appId: "1:952334299306:web:4a681bc6bcd99ea3c360d3",
  measurementId: "G-QZRGXKD9G3"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Track recently shown notifications to prevent duplicates
const recentNotifications = new Map(); // messageId -> timestamp
const DEDUP_WINDOW_MS = 10000; // 10 second dedup window

// Clean old entries from dedup map
function cleanRecentNotifications() {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [key, ts] of recentNotifications) {
    if (ts < cutoff) recentNotifications.delete(key);
  }
}

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Received background message:", payload);
  
  // Build a dedup key from messageId or content hash
  const dedupKey = payload.messageId 
    || payload.collapseKey 
    || `${payload.notification?.title}_${payload.notification?.body}_${payload.data?.timestamp || ''}`;
  
  cleanRecentNotifications();
  
  if (recentNotifications.has(dedupKey)) {
    console.log("[firebase-messaging-sw.js] Skipping duplicate notification:", dedupKey);
    return; // Already shown recently
  }
  recentNotifications.set(dedupKey, Date.now());
  
  const notificationTitle = payload.notification?.title || "StockFlow";
  const notificationOptions = {
    body: payload.notification?.body || "You have a new notification",
    icon: "/image/stockflow logo.png",
    badge: "/image/stockflow logo.png",
    tag: dedupKey, // OS-level dedup: same tag replaces previous notification
    renotify: false,
    data: payload.data || {},
    actions: [
      {
        action: "open_app",
        title: "Open StockFlow",
        icon: "/image/stockflow logo.png"
      }
    ]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log("[firebase-messaging-sw.js] Notification click received.");
  
  event.notification.close();
  
  // Handle different actions
  if (event.action === 'open_app') {
    // Open the app
    event.waitUntil(
      clients.openWindow('/')
    );
  } else {
    // Default action - open the app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});