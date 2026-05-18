/**
 * Server-side cache manager for reducing Firestore quota consumption
 * Implements TTL-based caching for frequently-accessed data
 * 
 * Caches:
 * - User -> Organization mappings
 * - FCM tokens by organization
 * - Organization metadata
 * - Device registrations
 * 
 * All caches auto-expire with configurable TTL
 */

class CacheManager {
  constructor() {
    // In-memory cache with TTL
    this.cache = new Map();
    
    // Configuration
    this.DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
    this.USER_ORG_TTL = 10 * 60 * 1000; // 10 minutes (user org doesn't change often)
    this.FCM_TOKEN_TTL = 15 * 60 * 1000; // 15 minutes (tokens are persistent)
    this.ORG_METADATA_TTL = 30 * 60 * 1000; // 30 minutes
    
    // Cache stats for monitoring
    this.stats = {
      hits: 0,
      misses: 0,
      expires: 0
    };
    
    // Cleanup interval - run every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get item from cache, return null if expired or not found
   */
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      this.stats.expires++;
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return item.value;
  }

  /**
   * Set item in cache with TTL
   */
  set(key, value, ttl = this.DEFAULT_TTL) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now()
    });
  }

  /**
   * Remove item from cache
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, expires: 0 };
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    let expiredCount = 0;
    for (const [key, item] of this.cache.entries()) {
      if (Date.now() > item.expiresAt) {
        this.cache.delete(key);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      console.log(`🧹 Cache cleanup: removed ${expiredCount} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;
    
    return {
      ...this.stats,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get or set with callback pattern
   */
  async getOrSet(key, callback, ttl = this.DEFAULT_TTL) {
    const cached = this.get(key);
    if (cached) {
      return cached;
    }

    const value = await callback();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Destroy cache (cleanup interval)
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.clear();
  }
}

// Export singleton instance
module.exports = new CacheManager();
