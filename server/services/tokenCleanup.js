const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * Clean invalid device tokens from Firestore based on FCM send results
 * @param {string} orgId - Organization ID
 * @param {object} multicastResult - Result from admin.messaging().sendMulticast()
 * @param {string[]} tokens - Array of tokens that were sent (in same order as results)
 */
const cleanInvalidTokens = async (orgId, multicastResult, tokens) => {
  try {
    if (!orgId || !multicastResult || !tokens) {
      throw new Error('orgId, multicastResult, and tokens are required');
    }

    if (!multicastResult.responses || multicastResult.responses.length !== tokens.length) {
      throw new Error('Responses array length must match tokens array length');
    }

    const invalidTokens = [];
    const validationErrors = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument'
    ];

    // Identify invalid tokens from the responses
    multicastResult.responses.forEach((response, index) => {
      if (!response.success && response.error) {
        const errorCode = response.error.code;
        
        if (validationErrors.includes(errorCode)) {
          invalidTokens.push({
            token: tokens[index],
            error: errorCode,
            index: index
          });
        }
      }
    });

    if (invalidTokens.length === 0) {
      console.log(`✅ No invalid tokens to clean for org: ${orgId}`);
      return {
        success: true,
        tokensRemoved: 0,
        errors: []
      };
    }

    console.log(`🗑️ Found ${invalidTokens.length} invalid tokens for org: ${orgId}`);

    // Remove invalid tokens from Firestore in batch
    const batch = db.batch();
    const removalErrors = [];

    for (const invalidToken of invalidTokens) {
      try {
        const tokenDocRef = db.collection('organizations').doc(orgId).collection('deviceTokens').doc(invalidToken.token);
        batch.delete(tokenDocRef);
        
        console.log(`🗑️ Marked for removal: Token ending in ...${invalidToken.token.slice(-8)} (${invalidToken.error})`);
      } catch (error) {
        console.error(`❌ Error preparing token removal: ${invalidToken.token}`, error.message);
        removalErrors.push({
          token: invalidToken.token,
          error: error.message
        });
      }
    }

    // Commit the batch deletion
    await batch.commit();

    const successfulRemovals = invalidTokens.length - removalErrors.length;
    console.log(`✅ Successfully removed ${successfulRemovals} invalid tokens from org: ${orgId}`);

    if (removalErrors.length > 0) {
      console.warn(`⚠️ Failed to remove ${removalErrors.length} tokens from org: ${orgId}`);
    }

    return {
      success: true,
      tokensRemoved: successfulRemovals,
      errors: removalErrors
    };

  } catch (error) {
    console.error(`❌ Error cleaning invalid tokens for org ${orgId}:`, error.message);
    throw error;
  }
};

/**
 * Clean a single invalid token from Firestore
 * @param {string} orgId - Organization ID
 * @param {string} token - Invalid FCM token
 * @param {string} errorCode - Error code from FCM
 */
const cleanSingleInvalidToken = async (orgId, token, errorCode = 'unknown-error') => {
  try {
    if (!orgId || !token) {
      throw new Error('orgId and token are required');
    }

    const tokenDocRef = db.collection('organizations').doc(orgId).collection('deviceTokens').doc(token);
    const tokenDoc = await tokenDocRef.get();

    if (!tokenDoc.exists) {
      console.warn(`⚠️ Token already removed or not found: ...${token.slice(-8)} in org: ${orgId}`);
      return { success: true, wasAlreadyRemoved: true };
    }

    await tokenDocRef.delete();
    
    console.log(`🗑️ Removed invalid token: ...${token.slice(-8)} from org: ${orgId} (${errorCode})`);

    return {
      success: true,
      wasAlreadyRemoved: false,
      errorCode: errorCode
    };

  } catch (error) {
    console.error(`❌ Error removing single token from org ${orgId}:`, error.message);
    throw error;
  }
};

/**
 * Get statistics about device tokens for an organization
 * @param {string} orgId - Organization ID
 */
const getTokenStats = async (orgId) => {
  try {
    if (!orgId) {
      throw new Error('orgId is required');
    }

    const tokensSnapshot = await db.collection('organizations').doc(orgId).collection('deviceTokens').get();
    
    const stats = {
      total: tokensSnapshot.size,
      platforms: {},
      users: new Set(),
      oldestToken: null,
      newestToken: null
    };

    tokensSnapshot.forEach(doc => {
      const data = doc.data();
      
      // Count platforms
      if (data.platform) {
        stats.platforms[data.platform] = (stats.platforms[data.platform] || 0) + 1;
      }
      
      // Count unique users
      if (data.uid) {
        stats.users.add(data.uid);
      }
      
      // Track oldest/newest tokens
      const createdAt = data.createdAt?.toDate?.();
      if (createdAt) {
        if (!stats.oldestToken || createdAt < stats.oldestToken) {
          stats.oldestToken = createdAt;
        }
        if (!stats.newestToken || createdAt > stats.newestToken) {
          stats.newestToken = createdAt;
        }
      }
    });

    stats.uniqueUsers = stats.users.size;
    delete stats.users; // Remove Set object for JSON serialization

    console.log(`📊 Token stats for org ${orgId}: ${stats.total} tokens, ${stats.uniqueUsers} users`);

    return stats;

  } catch (error) {
    console.error(`❌ Error getting token stats for org ${orgId}:`, error.message);
    throw error;
  }
};

module.exports = {
  cleanInvalidTokens,
  cleanSingleInvalidToken,
  getTokenStats
};