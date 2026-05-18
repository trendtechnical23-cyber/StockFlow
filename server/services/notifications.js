const admin = require('firebase-admin');

/**
 * Send notification to organization members using stored device tokens
 * @param {string} orgId - Organization ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data to send
 */
const sendOrgNotificationByTokens = async (orgId, title, body, data = {}) => {
  try {
    if (!orgId || !title || !body) {
      throw new Error('orgId, title, and body are required');
    }

    const db = admin.firestore();
    
    // Fetch device tokens for the organization
    const tokensSnapshot = await db.collection(`orgs/${orgId}/deviceTokens`).get();
    
    if (tokensSnapshot.empty) {
      console.warn(`⚠️ No device tokens found for org: ${orgId}`);
      return { success: true, tokensProcessed: 0, invalidTokensRemoved: 0 };
    }

    const tokens = [];
    const tokenDocs = [];
    
    tokensSnapshot.forEach(doc => {
      const tokenData = doc.data();
      if (tokenData.token) {
        tokens.push(tokenData.token);
        tokenDocs.push({ id: doc.id, token: tokenData.token });
      }
    });

    if (tokens.length === 0) {
      console.warn(`⚠️ No valid tokens found for org: ${orgId}`);
      return { success: true, tokensProcessed: 0, invalidTokensRemoved: 0 };
    }

    // Prepare message payload
    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        orgId: orgId,
        timestamp: Date.now().toString(),
        ...data
      }
    };

    let invalidTokensRemoved = 0;

    if (tokens.length === 1) {
      // Single token send
      try {
        await admin.messaging().send({
          ...message,
          token: tokens[0]
        });
        console.log(`✅ Notification sent to 1 device for org: ${orgId}`);
      } catch (error) {
        if (error.code === 'messaging/invalid-registration-token' || 
            error.code === 'messaging/registration-token-not-registered') {
          // Remove invalid token
          await db.doc(`orgs/${orgId}/deviceTokens/${tokenDocs[0].id}`).delete();
          invalidTokensRemoved = 1;
          console.warn(`🗑️ Removed invalid token for org: ${orgId}`);
        } else {
          throw error;
        }
      }
    } else {
      // Multicast send
      const multicastMessage = {
        ...message,
        tokens: tokens
      };

      const response = await admin.messaging().sendMulticast(multicastMessage);
      
      console.log(`✅ Notification sent to ${response.successCount}/${tokens.length} devices for org: ${orgId}`);

      // Handle failed tokens
      if (response.failureCount > 0) {
        const failedTokens = [];
        
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const error = resp.error;
            if (error.code === 'messaging/invalid-registration-token' || 
                error.code === 'messaging/registration-token-not-registered') {
              failedTokens.push(tokenDocs[idx]);
            }
          }
        });

        // Remove invalid tokens from Firestore
        if (failedTokens.length > 0) {
          const batch = db.batch();
          failedTokens.forEach(tokenDoc => {
            batch.delete(db.doc(`orgs/${orgId}/deviceTokens/${tokenDoc.id}`));
          });
          
          await batch.commit();
          invalidTokensRemoved = failedTokens.length;
          console.warn(`🗑️ Removed ${invalidTokensRemoved} invalid tokens for org: ${orgId}`);
        }
      }
    }

    return {
      success: true,
      tokensProcessed: tokens.length,
      invalidTokensRemoved: invalidTokensRemoved
    };

  } catch (error) {
    console.error(`❌ Error sending notification by tokens for org ${orgId}:`, error.message);
    throw error;
  }
};

/**
 * Send notification to organization topic
 * @param {string} orgId - Organization ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data to send
 */
const sendOrgNotificationByTopic = async (orgId, title, body, data = {}) => {
  try {
    if (!orgId || !title || !body) {
      throw new Error('orgId, title, and body are required');
    }

    const message = {
      topic: `org_${orgId}`,
      notification: {
        title: title,
        body: body
      },
      data: {
        orgId: orgId,
        timestamp: Date.now().toString(),
        ...data
      }
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Topic notification sent for org: ${orgId}, messageId: ${response}`);

    return {
      success: true,
      messageId: response
    };

  } catch (error) {
    console.error(`❌ Error sending topic notification for org ${orgId}:`, error.message);
    throw error;
  }
};

/**
 * Subscribe device token to organization topic
 * @param {string} token - Device FCM token
 * @param {string} orgId - Organization ID
 */
const subscribeTokenToOrgTopic = async (token, orgId) => {
  try {
    if (!token || !orgId) {
      throw new Error('token and orgId are required');
    }

    const topic = `org_${orgId}`;
    const response = await admin.messaging().subscribeToTopic([token], topic);
    
    if (response.failureCount > 0) {
      const error = response.errors[0];
      console.error(`❌ Failed to subscribe token to topic ${topic}:`, error.error.message);
      throw new Error(`Subscription failed: ${error.error.message}`);
    }

    console.log(`✅ Token subscribed to topic: ${topic}`);
    return { success: true, topic: topic };

  } catch (error) {
    console.error(`❌ Error subscribing token to org ${orgId} topic:`, error.message);
    throw error;
  }
};

/**
 * Unsubscribe device token from organization topic
 * @param {string} token - Device FCM token
 * @param {string} orgId - Organization ID
 */
const unsubscribeTokenFromOrgTopic = async (token, orgId) => {
  try {
    if (!token || !orgId) {
      throw new Error('token and orgId are required');
    }

    const topic = `org_${orgId}`;
    const response = await admin.messaging().unsubscribeFromTopic([token], topic);
    
    if (response.failureCount > 0) {
      const error = response.errors[0];
      console.error(`❌ Failed to unsubscribe token from topic ${topic}:`, error.error.message);
      throw new Error(`Unsubscription failed: ${error.error.message}`);
    }

    console.log(`✅ Token unsubscribed from topic: ${topic}`);
    return { success: true, topic: topic };

  } catch (error) {
    console.error(`❌ Error unsubscribing token from org ${orgId} topic:`, error.message);
    throw error;
  }
};

module.exports = {
  sendOrgNotificationByTokens,
  sendOrgNotificationByTopic,
  subscribeTokenToOrgTopic,
  unsubscribeTokenFromOrgTopic
};