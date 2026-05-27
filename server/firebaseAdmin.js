/**
 * Firebase Admin — REMOVED.
 * Firebase project has been deleted. This stub keeps old imports from crashing.
 * All functions throw or return null/undefined gracefully.
 */

const messaging = null;
const database  = null;
const admin     = {
  auth:      () => ({ getUser: async () => null, setCustomUserClaims: async () => {}, createUser: async () => ({}), deleteUser: async () => {} }),
  firestore: () => null,
  database:  () => null,
  messaging: () => null,
};

module.exports = { admin, messaging, database };
