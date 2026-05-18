import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getDatabase, ref, set } from "firebase/database";
import { getAuth } from "firebase/auth";

let messaging: any = null;

// VAPID key from Firebase Console
const VAPID_KEY = "BHhVhoQ_3faLd5Ot0sMizm44IdYmW_7eXKxLzwARhChcXAvHOkg9XLvASWv-QFJihzFqBnXn8N5ukY__iYjIXlQ";

/**
 * Initialize Firebase Messaging
 */
let messagingInitialized = false;

export const initializeMessaging = async () => {
  if (messagingInitialized) {
    return; // Prevent duplicate initialization
  }

  try {
    // Register service worker first (only in production or if needed for development)
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      try {
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('✅ Service worker registered');
      } catch (swError) {
        // Service worker not critical for development - fail silently
        console.warn('⚠️ Service worker unavailable (HTTPS required for production)');
      }
    }

    messaging = getMessaging();
    messagingInitialized = true;
    console.log("✅ Firebase Messaging initialized");
    
    // Set up foreground message listener
    onMessage(messaging, (payload) => {
      console.log("🔔 Foreground FCM message received:", payload);
      
      // Show browser notification if permission granted
      if (Notification.permission === "granted" && payload.notification) {
        new Notification(payload.notification.title || "StockFlow", {
          body: payload.notification.body || "",
          icon: "/image/stockflow logo.png",
          badge: "/image/stockflow logo.png",
          data: payload.data || {}
        });
      }
      
      // Dispatch custom event for React components
      const event = new CustomEvent('fcmMessage', { detail: payload });
      window.dispatchEvent(event);
    });
    
  } catch (error) {
    console.error("❌ Failed to initialize Firebase Messaging:", error);
  }
};

/**
 * Request notification permission and get FCM token
 */
let permissionRequested = false;

export const requestFCMPermission = async (): Promise<string | null> => {
  // Only request once per session
  if (permissionRequested) {
    return null;
  }
  permissionRequested = true;

  try {
    // Skip FCM on localhost HTTP (service workers require HTTPS)
    if (window.location.protocol === 'http:' && window.location.hostname === 'localhost') {
      console.log("ℹ️ FCM disabled on localhost HTTP (requires HTTPS in production)");
      return null;
    }

    console.log("🔔 Requesting notification permission...");
    
    // Request permission
    const permission = await Notification.requestPermission();
    console.log("🔔 Notification permission:", permission);
    
    if (permission === "denied") {
      console.warn("⚠️ Notification permission denied by user");
      return null;
    }
    
    if (permission !== "granted") {
      console.warn("⚠️ Notification permission not granted");
      return null;
    }

    if (!messaging) {
      await initializeMessaging();
    }

    console.log("🔑 Getting FCM token...");
    
    // Get token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
    });

    if (token) {
      console.log("✅ FCM token received");
      
      // Store token in Realtime Database
      await storeFCMToken(token);
      
      return token;
    } else {
      console.warn("⚠️ No FCM token available");
      return null;
    }
    
  } catch (error: any) {
    // Suppress noisy service worker errors in development
    if (error?.code === 'messaging/failed-service-worker-registration') {
      console.log("ℹ️ FCM unavailable (HTTPS required for production)");
    } else {
      console.error("❌ Error getting FCM token:", error);
    }
    return null;
  }
};

/**
 * Store FCM token in Firestore (organization-scoped)
 */
const storeFCMToken = async (token: string): Promise<void> => {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    
    if (!user) {
      console.warn("⚠️ No authenticated user, cannot store FCM token");
      return;
    }

    // Get organization ID from localStorage (set during login)
    const organizationId = localStorage.getItem('organizationId');
    if (!organizationId) {
      console.warn("⚠️ No organization ID found, cannot store FCM token");
      return;
    }

    console.log(`💾 Storing FCM token for org: ${organizationId}`);
    
    // Import Firestore functions
    const { getFirestore, doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const firestore = getFirestore();
    
    // Store in Firestore at the path the server expects: orgs/{orgId}/deviceTokens/{userId}
    const tokenRef = doc(firestore, `orgs/${organizationId}/deviceTokens`, user.uid);
    
    await setDoc(tokenRef, {
      token,
      userId: user.uid,
      userEmail: user.email,
      platform: 'web',
      deviceType: 'dashboard',
      organizationId,
      createdAt: serverTimestamp(),
      lastSeen: serverTimestamp()
    }, { merge: true }); // Merge to avoid overwriting existing data
    
    console.log("✅ FCM token stored successfully");
    
  } catch (error) {
    console.warn("⚠️ Failed to store FCM token:", error);
    // Don't throw - token storage failure shouldn't break the app
  }
};

/**
 * Check if FCM is supported in this browser
 */
export const isFCMSupported = (): boolean => {
  return typeof window !== "undefined" && 
         "serviceWorker" in navigator && 
         "PushManager" in window &&
         "Notification" in window;
};

/**
 * Get current notification permission status
 */
export const getNotificationPermission = (): NotificationPermission => {
  return typeof window !== "undefined" ? Notification.permission : "default";
};

/**
 * Set up FCM token refresh (call this after user logs in)
 */
export const setupFCMForUser = async (): Promise<void> => {
  try {
    if (!isFCMSupported()) {
      console.warn("❌ FCM not supported in this browser");
      return;
    }

    console.log("🚀 Setting up FCM for authenticated user...");
    
    // Initialize messaging if not done already
    if (!messaging) {
      await initializeMessaging();
    }

    // Request permission and get token
    const token = await requestFCMPermission();
    
    if (token) {
      console.log("✅ FCM setup complete for user");
    } else {
      console.warn("⚠️ FCM setup failed - no token received");
    }
    
  } catch (error) {
    console.error("❌ Failed to setup FCM for user:", error);
  }
};

// Debug function to check stock take session in database
const debugStockTakeSession = async (orgId: string) => {
  try {
    const database = getDatabase();
    const { ref, get } = await import('firebase/database');
    const sessionsRef = ref(database, `organizations/${orgId}/stockTakeSessions`);
    const snapshot = await get(sessionsRef);
    
    if (snapshot.exists()) {
      const sessions = snapshot.val();
      console.log('📋 Stock take sessions in database:', Object.keys(sessions));
      Object.entries(sessions).forEach(([id, session]: [string, any]) => {
        console.log(`   Session ${id}:`, session.status, 'Started by:', session.startedBy);
      });
    } else {
      console.log('📋 No stock take sessions found in database');
    }
  } catch (error) {
    console.error('❌ Error checking stock take sessions:', error);
  }
};

// Export the messaging instance for advanced usage
export { messaging };

// Make FCM functions available in console for testing
declare global {
  interface Window {
    testFCM: () => Promise<void>;
    getFCMToken: () => Promise<string | null>;
    debugStockTakeSessions: () => Promise<void>;
  }
}

if (typeof window !== 'undefined') {
  window.testFCM = async () => {
    console.log('🧪 Testing FCM setup...');
    try {
      await initializeMessaging();
      const token = await requestFCMPermission();
      if (token) {
        console.log('✅ FCM test successful! Token:', token.substring(0, 20) + '...');
      } else {
        console.error('❌ FCM test failed - no token received');
      }
    } catch (error) {
      console.error('❌ FCM test failed:', error);
    }
  };

  window.getFCMToken = async () => {
    try {
      if (!messaging) {
        await initializeMessaging();
      }
      return await getToken(messaging, { vapidKey: VAPID_KEY });
    } catch (error) {
      console.error('❌ Failed to get FCM token:', error);
      return null;
    }
  };

  window.debugStockTakeSessions = async () => {
    const orgId = localStorage.getItem('organizationId');
    if (!orgId) {
      console.error('❌ No organization ID found');
      return;
    }
    await debugStockTakeSession(orgId);
  };
}