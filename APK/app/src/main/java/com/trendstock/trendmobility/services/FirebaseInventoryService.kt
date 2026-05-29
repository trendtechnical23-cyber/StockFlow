package com.trendstock.trendmobility.services

import android.content.Context
import android.util.Log
import com.trendstock.trendmobility.api.InventoryItem
import com.trendstock.trendmobility.database.InventoryRepository
import com.trendstock.trendmobility.database.toInventoryItem
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * FirebaseInventoryService — class name preserved so existing callers compile.
 *
 * Firebase Realtime Database has been removed.  All inventory data now comes
 * from the local Room cache (populated by GET /api/mobile/inventory on login
 * and FCM-triggered refreshes).
 */
class FirebaseInventoryService(private val context: Context? = null) {

    private val repo: InventoryRepository? = context?.let { InventoryRepository.getInstance(it) }

    suspend fun getCachedInventory(): InventoryResponse {
        val items = repo?.getAllItemsFlow()?.let { flow ->
            var result = emptyList<InventoryItem>()
            flow.collect { entities -> result = entities.map { it.toInventoryItem() } }
            result
        } ?: emptyList()

        return InventoryResponse(
            items    = items,
            metadata = CacheMetadata(
                cachedAt   = System.currentTimeMillis().toString(),
                totalItems = items.size,
                source     = "room_cache",
                cacheExpiry = ""
            )
        )
    }

    fun listenToInventoryUpdates(): Flow<InventoryResponse> {
        val flow = repo?.getAllItemsFlow()
            ?: throw IllegalStateException("Context required to use listenToInventoryUpdates()")

        return flow.map { entities ->
            InventoryResponse(
                items = entities.map { it.toInventoryItem() },
                metadata = CacheMetadata(
                    cachedAt   = System.currentTimeMillis().toString(),
                    totalItems = entities.size,
                    source     = "room_cache",
                    cacheExpiry = ""
                )
            )
        }
    }

    suspend fun updateItemQuantity(itemId: String, newQuantity: Int): Boolean {
        return try {
            repo?.updateItemQuantity(itemId, newQuantity)
            true
        } catch (e: Exception) {
            Log.e("FirebaseInventoryService", "updateItemQuantity failed: ${e.message}")
            false
        }
    }

    suspend fun getCacheStatus(): CacheStatus {
        val stats = repo?.getCacheStats()
        return CacheStatus(
            hasCache          = (stats?.itemCount ?: 0) > 0,
            lastSyncTimestamp = stats?.lastFetchTime?.toString() ?: "",
            itemsCount        = stats?.itemCount ?: 0
        )
    }
}

data class InventoryResponse(
    val items:    List<InventoryItem>,
    val metadata: CacheMetadata? = null,
)

data class CacheMetadata(
    val cachedAt:    String,
    val totalItems:  Int,
    val source:      String,
    val cacheExpiry: String,
)

data class CacheStatus(
    val hasCache:          Boolean,
    val lastSyncTimestamp: String,
    val itemsCount:        Int,
)
