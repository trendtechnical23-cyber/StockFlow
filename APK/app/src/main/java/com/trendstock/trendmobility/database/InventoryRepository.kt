package com.trendstock.trendmobility.database

import android.content.Context
import android.util.Log
import com.trendstock.trendmobility.api.ApiClient
import com.trendstock.trendmobility.auth.AuthManager
import com.trendstock.trendmobility.utils.OrganizationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * InventoryRepository — local Room cache backed by the Railway backend API.
 *
 * Replaces the Firestore direct-read approach:
 *   • refreshInventory() calls GET /api/mobile/inventory (Railway → Supabase)
 *   • setupRealtimeSync() is driven by FCM push notifications (no Firestore listener)
 *   • Incremental updates from FCM triggers a full cache refresh (simple, reliable)
 */
class InventoryRepository private constructor(private val context: Context) {

    private val db  = AppDatabase.getInstance(context)
    private val dao = db.inventoryDao()

    companion object {
        private const val TAG              = "InventoryRepository"
        private const val CACHE_VALIDITY_MS = 5 * 60 * 1000L // 5 minutes

        @Volatile private var INSTANCE: InventoryRepository? = null

        fun getInstance(context: Context): InventoryRepository =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: InventoryRepository(context.applicationContext).also { INSTANCE = it }
            }
    }

    // ── Cache reads ────────────────────────────────────────────────────────────

    fun getAllItemsFlow(): Flow<List<InventoryEntity>> = dao.getAllItems()

    suspend fun getItemById(itemId: String): InventoryEntity? =
        withContext(Dispatchers.IO) { dao.getItemById(itemId) }

    fun searchItems(query: String): Flow<List<InventoryEntity>> = dao.searchItems(query)

    suspend fun isCacheValid(): Boolean = withContext(Dispatchers.IO) {
        val last = dao.getLastFetchTime() ?: return@withContext false
        (System.currentTimeMillis() - last) < CACHE_VALIDITY_MS
    }

    // ── Remote fetch ───────────────────────────────────────────────────────────

    /**
     * Fetch all inventory from GET /api/mobile/inventory and upsert into Room.
     * Uses OnConflictStrategy.REPLACE so new and modified items are handled
     * identically — no full delete needed.
     */
    suspend fun refreshInventory(forceRefresh: Boolean = false): Result<Unit> =
        withContext(Dispatchers.IO) {
            try {
                if (!forceRefresh && isCacheValid()) {
                    Log.d(TAG, "Cache valid — skipping refresh")
                    return@withContext Result.success(Unit)
                }

                val accessToken = AuthManager.getAccessToken()
                if (accessToken.isNullOrBlank()) {
                    return@withContext Result.failure(Exception("Not authenticated"))
                }

                val orgId = OrganizationManager.getCurrentOrganizationId()
                if (orgId.isNullOrBlank()) {
                    return@withContext Result.failure(Exception("No organisation — please sign in again."))
                }

                Log.d(TAG, "Fetching inventory for org: $orgId")

                val response = ApiClient.mobileService.getInventory(
                    auth  = "Bearer $accessToken",
                    orgId = orgId,
                )

                if (!response.isSuccessful || response.body()?.success != true) {
                    val msg = response.body()?.message ?: "HTTP ${response.code()}"
                    return@withContext Result.failure(Exception("Inventory fetch failed: $msg"))
                }

                val items = (response.body()?.data?.items ?: emptyList()).map { item ->
                    InventoryEntity(
                        itemId             = item.itemId,
                        name               = item.name,
                        sku                = item.sku,
                        quantityAvailable  = item.quantityAvailable,
                        unit               = item.unit,
                        rate               = item.rate,
                        lastFetchedAt      = System.currentTimeMillis(),
                    )
                }

                dao.insertItems(items)
                Log.d(TAG, "✅ Cached ${items.size} inventory items")
                Result.success(Unit)

            } catch (e: Exception) {
                Log.e(TAG, "refreshInventory error: ${e.message}", e)
                Result.failure(e)
            }
        }

    /**
     * Trigger a refresh from outside the coroutine context (e.g. FCM handler).
     * Used when a push notification signals that inventory has changed.
     */
    fun triggerRefreshFromFCM() {
        CoroutineScope(Dispatchers.IO).launch {
            Log.d(TAG, "🔔 FCM-triggered inventory refresh")
            refreshInventory(forceRefresh = true)
        }
    }

    // ── Realtime sync stubs (kept for callers — FCM-driven, no Firestore) ────────

    /** No-op: inventory sync is now FCM-driven. Kept so callers compile. */
    suspend fun setupRealtimeSync() {
        android.util.Log.d("InventoryRepository", "setupRealtimeSync: FCM-driven, no listener to set up")
    }

    /** No-op: no Firestore listener to tear down. */
    fun stopRealtimeSync() {
        android.util.Log.d("InventoryRepository", "stopRealtimeSync: nothing to stop")
    }

    // ── Cache utilities ────────────────────────────────────────────────────────

    suspend fun updateItemQuantity(itemId: String, newQuantity: Int) = withContext(Dispatchers.IO) {
        dao.updateQuantity(itemId, newQuantity)
        Log.d(TAG, "Optimistic update: $itemId → $newQuantity")
    }

    suspend fun clearCache() = withContext(Dispatchers.IO) {
        dao.deleteAllItems()
        Log.d(TAG, "Cache cleared")
    }

    suspend fun getCacheStats(): CacheStats = withContext(Dispatchers.IO) {
        CacheStats(
            itemCount    = dao.getItemCount(),
            lastFetchTime = dao.getLastFetchTime(),
            isValid      = isCacheValid(),
        )
    }
}

data class CacheStats(
    val itemCount:     Int,
    val lastFetchTime: Long?,
    val isValid:       Boolean,
)
