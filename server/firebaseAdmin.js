/**
 * Firebase Admin SDK
 *
 * Initializes using credentials from environment variables.
 * Exports null values gracefully when credentials are not configured.
 *
 * To enable:
 *   Option A (recommended for Railway):
 *     Set FIREBASE_SERVICE_ACCOUNT_JSON = <JSON string of service account key>
 *
 *   Option B (local dev):
 *     Set FIREBASE_KEY_PATH = ./firebase-admin-key.json
 *     (relative to this file's directory)
 *
 * If neither is set, exports null — all callers that use messaging/database
 * must check for null before use.
 */

let admin    = null;
let messaging = null;
let database  = null;

try {
  const firebaseAdmin = require('firebase-admin');

  if (firebaseAdmin.apps.length > 0) {
    // Already initialized (e.g. hot-reload in dev)
    admin     = firebaseAdmin;
    messaging = firebaseAdmin.messaging();
    database  = firebaseAdmin.database();
  } else {
    let credential;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = firebaseAdmin.credential.cert(serviceAccount);
    } else if (process.env.FIREBASE_KEY_PATH) {
      const path = require('path');
      const keyPath = path.resolve(__dirname, process.env.FIREBASE_KEY_PATH);
      credential = firebaseAdmin.credential.cert(require(keyPath));
    } else {
      console.warn('[Firebase] No credentials configured — FCM and Realtime DB disabled.');
      module.exports = { admin: null, messaging: null, database: null };
      return;
    }

    const config = { credential };

    if (process.env.FIREBASE_DATABASE_URL) {
      config.databaseURL = process.env.FIREBASE_DATABASE_URL;
    }

    firebaseAdmin.initializeApp(config);

    admin     = firebaseAdmin;
    messaging = firebaseAdmin.messaging();
    database  = process.env.FIREBASE_DATABASE_URL ? firebaseAdmin.database() : null;

    console.log('[Firebase] ✅ Firebase Admin SDK initialized');
    if (database) console.log('[Firebase] ✅ Realtime Database connected');
  }
} catch (err) {
  console.warn('[Firebase] Init failed (non-fatal):', err.message);
}

module.exports = { admin, messaging, database };
