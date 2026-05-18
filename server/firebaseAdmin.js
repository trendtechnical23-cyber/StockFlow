const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.resolve("./firebase-admin-key.json"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://stockflow-dashboard-a1aa6-default-rtdb.asia-southeast1.firebasedatabase.app"
  });
}

const messaging = admin.messaging();
const database = admin.database();
const firestore = admin.firestore();

module.exports = {
  messaging,
  database,
  firestore,
  admin: admin
};