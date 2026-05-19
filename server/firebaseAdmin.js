const admin = require('firebase-admin');
const path = require('path');

if (!admin.apps.length) {
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
}

const messaging = admin.messaging();
const firestore = admin.firestore();

// Realtime Database is optional — only available when FIREBASE_DATABASE_URL is set.
// Wrapping in try/catch prevents a synchronous FirebaseError from crashing the
// process during require(), which would kill the server before /health can respond.
let database = null;
try {
  database = admin.database();
} catch (err) {
  console.warn('⚠️ Firebase Realtime Database unavailable (FIREBASE_DATABASE_URL not set):', err.message);
}

module.exports = { messaging, database, firestore, admin };
