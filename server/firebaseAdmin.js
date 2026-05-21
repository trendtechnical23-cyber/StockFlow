const admin = require('firebase-admin');
const path = require('path');

// Only init if server.js hasn't already done so. Wrapped in try-catch so a bad
// service account / missing env var doesn't crash the process at require() time.
if (!admin.apps.length) {
  try {
    let serviceAccount;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    } else {
      const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve('./firebase-admin-key.json');
      serviceAccount = require(keyPath);
    }

    const appConfig = { credential: admin.credential.cert(serviceAccount) };
    if (process.env.FIREBASE_DATABASE_URL) {
      appConfig.databaseURL = process.env.FIREBASE_DATABASE_URL;
    }

    admin.initializeApp(appConfig);
  } catch (err) {
    console.error('❌ firebaseAdmin.js: Firebase init failed (non-fatal):', err.message);
  }
}

// All Firebase service accessors are lazy so that if Firebase Admin init failed
// (bad env vars etc.) the process doesn't crash at require() time.
let _messaging = null;
let _firestore = null;
let _database = null;

const getMessaging = () => {
  if (!_messaging) _messaging = admin.messaging();
  return _messaging;
};

const getFirestore = () => {
  if (!_firestore) _firestore = admin.firestore();
  return _firestore;
};

const getDatabase = () => {
  if (_database !== undefined) return _database;
  try {
    _database = admin.database();
  } catch (err) {
    console.warn('⚠️ Firebase Realtime Database unavailable (FIREBASE_DATABASE_URL not set):', err.message);
    _database = null;
  }
  return _database;
};

// Backwards-compatible named exports — existing callers using destructuring
// ({ messaging, database }) get the lazily-resolved values at call time.
module.exports = {
  get messaging() { return getMessaging(); },
  get database() { return getDatabase(); },
  get firestore() { return getFirestore(); },
  admin,
};
