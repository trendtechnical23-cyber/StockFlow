/**
 * Optimized FCM Token Management Service
 * 
 * Handles:
 * - Token registration and deregistration
 * - Token pruning (removing invalid tokens)
 * - Batched multicast sending (max 500 tokens)
 * - Per-org rate limiting
 * - Duplicate detection
 */

const admin = require('firebase-admin');
const cacheManager = require('./cacheManager');

const getMessaging = () => admin.messaging();
const getFirestore = () => admin.firestore();

// Per-organization rate limiting (tokens sent per minute)
const ORG_RATE_LIMIT = 10000; // Send to max 10,000 tokens per org per minute
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const organizationSendCounts = new Map();

// FCM Multicast limit
const FCM_MULTICAST_LIMIT = 500;

class FCMTokenManager {
  /**
   * Register or update device FCM token
   */
  static async registerToken(orgId, userId, fcmToken, platform) {
    try {
      console.log(`📱 Registering FCM token for org=${orgId}, user=${userId}, platform=${platform}`);
      
      // Validate inputs
      if (!orgId || !userId || !fcmToken || !platform) {
        throw new Error('Missing required fields: orgId, userId, fcmToken, platform');
      }

      if (!['android', 'ios', 'web'].includes(platform)) {
        throw new Error(`Invalid platform: ${platform}`);
      }

      // Store token in Firestore
      const deviceRef = firestore
        .collection('organizations')
        .doc(orgId)
        .collection('devices')
        .doc(fcmToken); // Use token as device ID

      await deviceRef.set({
        fcmToken,
        platform,
        userId,
        registeredAt: admin.firestore.FieldValue.serverTimestamp(),
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true
      }, { merge: true });

      // Cache token in memory for quick lookups
      const cacheKey = `fcm_tokens:${orgId}`;
      cacheManager.delete(cacheKey); // Invalidate cache so next fetch gets fresh data

      console.log(`✅ FCM token registered: ${fcmToken.substring(0, 20)}...`);
      return { success: true, token: fcmToken };
    } catch (error) {
      console.error(`❌ Failed to register FCM token:`, error);
      throw error;
    }
  }

  /**
   * Get all valid FCM tokens for an organization
   */
  static async getOrganizationTokens(orgId, platform = null) {
    try {
      const cacheKey = platform ? `fcm_tokens:${orgId}:${platform}` : `fcm_tokens:${orgId}`;
      
      // Try cache first
      const cachedTokens = cacheManager.get(cacheKey);
      if (cachedTokens) {
        console.log(`⚡ FCM tokens from cache for org=${orgId}, count=${cachedTokens.length}`);
        return cachedTokens;
      }

      // Fetch from Firestore
      let query = firestore
        .collection('organizations')
        .doc(orgId)
        .collection('devices')
        .where('isActive', '==', true);

      if (platform) {
        query = query.where('platform', '==', platform);
      }

      const snapshot = await query.get();
      const tokens = snapshot.docs.map(doc => ({
        token: doc.data().fcmToken,
        platform: doc.data().platform,
        userId: doc.data().userId,
        docId: doc.id
      }));

      // Cache for 15 minutes
      cacheManager.set(cacheKey, tokens, 15 * 60 * 1000);

      console.log(`📋 Fetched ${tokens.length} active FCM tokens for org=${orgId}`);
      return tokens;
    } catch (error) {
      console.error(`❌ Failed to get FCM tokens for org=${orgId}:`, error);
      throw error;
    }
  }

  /**
   * Send notification to multiple devices with batching and rate limiting
   */
  static async sendToOrganization(orgId, message, options = {}) {
    try {
      const { platform = null, priority = 'normal', dryRun = false } = options;
      
      console.log(`🔔 Sending notification to org=${orgId}, priority=${priority}`);

      // Check rate limit
      if (!this.checkRateLimit(orgId)) {
        throw new Error(`Rate limit exceeded for org=${orgId}. Max ${ORG_RATE_LIMIT} tokens per minute.`);
      }

      // Get tokens
      const tokenData = await this.getOrganizationTokens(orgId, platform);
      if (tokenData.length === 0) {
        console.warn(`⚠️ No active FCM tokens found for org=${orgId}`);
        return { sent: 0, failed: 0, invalid: [] };
      }

      const tokens = tokenData.map(t => t.token);
      console.log(`📤 Sending to ${tokens.length} devices...`);

      // Send in batches of FCM_MULTICAST_LIMIT
      const results = {
        sent: 0,
        failed: 0,
        invalid: [],
        errors: []
      };

      for (let i = 0; i < tokens.length; i += FCM_MULTICAST_LIMIT) {
        const batch = tokens.slice(i, i + FCM_MULTICAST_LIMIT);
        
        try {
          const response = await getMessaging().sendMulticast({
            ...message,
            tokens: batch
          }, dryRun);

          console.log(`✅ Batch ${Math.floor(i / FCM_MULTICAST_LIMIT) + 1}: Sent=${response.successCount}, Failed=${response.failureCount}`);

          results.sent += response.successCount;
          results.failed += response.failureCount;

          // Handle failures and collect invalid tokens
          for (let j = 0; j < response.responses.length; j++) {
            const resp = response.responses[j];
            if (!resp.success) {
              const errorCode = resp.error?.code;
              const token = batch[j];

              results.errors.push({
                token: token.substring(0, 20) + '...',
                error: errorCode
              });

              // Remove invalid tokens
              if (['messaging/invalid-registration-token', 'messaging/invalid-argument'].includes(errorCode)) {
                results.invalid.push(token);
              }
            }
          }
        } catch (batchError) {
          console.error(`❌ Batch error:`, batchError);
          results.errors.push({ batch_size: batch.length, error: batchError.message });
        }
      }

      // Prune invalid tokens
      if (results.invalid.length > 0) {
        await this.pruneTokens(orgId, results.invalid);
      }

      // Update rate limit counter
      this.updateRateLimitCounter(orgId, results.sent);

      console.log(`📊 Notification complete: Sent=${results.sent}, Failed=${results.failed}, Invalid=${results.invalid.length}`);
      return results;
    } catch (error) {
      console.error(`❌ Failed to send notification to org=${orgId}:`, error);
      throw error;
    }
  }

  /**
   * Send notification to specific user
   */
  static async sendToUser(orgId, userId, message, options = {}) {
    try {
      const { priority = 'normal', dryRun = false } = options;

      console.log(`🔔 Sending notification to user=${userId} in org=${orgId}`);

      // Get user's devices
      const snapshot = await firestore
        .collection('organizations')
        .doc(orgId)
        .collection('devices')
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .get();

      const tokens = snapshot.docs.map(doc => doc.data().fcmToken);

      if (tokens.length === 0) {
        console.warn(`⚠️ No active devices for user=${userId}`);
        return { sent: 0, failed: 0 };
      }

      // Send to user's tokens
      const response = await getMessaging().sendMulticast({
        ...message,
        tokens
      }, dryRun);

      console.log(`✅ Sent to user: ${response.successCount} success, ${response.failureCount} failed`);
      return { sent: response.successCount, failed: response.failureCount };
    } catch (error) {
      console.error(`❌ Failed to send to user=${userId}:`, error);
      throw error;
    }
  }

  /**
   * Remove invalid tokens from Firestore
   */
  static async pruneTokens(orgId, invalidTokens) {
    try {
      if (invalidTokens.length === 0) return;

      console.log(`🧹 Pruning ${invalidTokens.length} invalid tokens from org=${orgId}`);

      const batch = getFirestore().batch();
      
      for (const token of invalidTokens) {
        const docRef = firestore
          .collection('organizations')
          .doc(orgId)
          .collection('devices')
          .doc(token);
        
        batch.delete(docRef);
      }

      await batch.commit();
      
      // Invalidate token cache
      cacheManager.delete(`fcm_tokens:${orgId}`);

      console.log(`✅ Pruned ${invalidTokens.length} tokens`);
    } catch (error) {
      console.error(`❌ Failed to prune tokens:`, error);
      // Don't throw - pruning is non-critical
    }
  }

  /**
   * Check organization rate limit
   */
  static checkRateLimit(orgId) {
    const now = Date.now();
    const key = `${orgId}`;
    
    if (!organizationSendCounts.has(key)) {
      organizationSendCounts.set(key, { count: 0, resetAt: now + RATE_LIMIT_WINDOW });
      return true;
    }

    const entry = organizationSendCounts.get(key);
    
    // Reset if window expired
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + RATE_LIMIT_WINDOW;
    }

    return entry.count < ORG_RATE_LIMIT;
  }

  /**
   * Update rate limit counter
   */
  static updateRateLimitCounter(orgId, tokenCount) {
    const key = `${orgId}`;
    
    if (!organizationSendCounts.has(key)) {
      organizationSendCounts.set(key, {
        count: tokenCount,
        resetAt: Date.now() + RATE_LIMIT_WINDOW
      });
    } else {
      organizationSendCounts.get(key).count += tokenCount;
    }
  }

  /**
   * Get FCM statistics
   */
  static async getStatistics(orgId) {
    try {
      const tokens = await this.getOrganizationTokens(orgId);
      const byPlatform = {};
      
      tokens.forEach(t => {
        byPlatform[t.platform] = (byPlatform[t.platform] || 0) + 1;
      });

      return {
        total: tokens.length,
        byPlatform,
        cacheStats: cacheManager.getStats()
      };
    } catch (error) {
      console.error(`❌ Failed to get FCM stats:`, error);
      throw error;
    }
  }
}

module.exports = FCMTokenManager;
