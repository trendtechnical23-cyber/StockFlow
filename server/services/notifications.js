/**
 * Notification service stub.
 * Firebase Cloud Messaging has been removed — this file keeps the API surface
 * so route files that call these functions don't crash, but all methods are no-ops.
 */

const sendOrgNotificationByTokens = async (orgId, title, body, data = {}) => {
  console.warn(`⚠️ [notifications] sendOrgNotificationByTokens called for org ${orgId} but FCM is not configured`);
  return { success: false, reason: 'FCM not configured', tokensProcessed: 0 };
};

const sendOrgNotificationByTopic = async (orgId, title, body, data = {}) => {
  console.warn(`⚠️ [notifications] sendOrgNotificationByTopic called for org ${orgId} but FCM is not configured`);
  return { success: false, reason: 'FCM not configured' };
};

const subscribeTokenToOrgTopic = async (token, orgId) => {
  console.warn(`⚠️ [notifications] subscribeTokenToOrgTopic called but FCM is not configured`);
  return { success: false, reason: 'FCM not configured' };
};

const unsubscribeTokenFromOrgTopic = async (token, orgId) => {
  console.warn(`⚠️ [notifications] unsubscribeTokenFromOrgTopic called but FCM is not configured`);
  return { success: false, reason: 'FCM not configured' };
};

module.exports = {
  sendOrgNotificationByTokens,
  sendOrgNotificationByTopic,
  subscribeTokenToOrgTopic,
  unsubscribeTokenFromOrgTopic,
};
