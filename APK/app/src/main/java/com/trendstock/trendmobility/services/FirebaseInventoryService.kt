package com.trendstock.trendmobility.services

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import com.google.firebase.firestore.FirebaseFirestore
import com.trendstock.trendmobility.api.InventoryItem
import com.stockflow.inventory.RealtimeActivityService
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Firebase Realtime Database Service for Inventory Management
 * Handles reading inventory data from Firebase cache
 */
class FirebaseInventoryService {
    
    private val database = FirebaseDatabase.getInstance()
    private val inventoryRef = database.getReference("inventory")
    private val metaRef = database.getReference("meta")
    
    /**
     * Get cached inventory items from Firebase
     * @return InventoryResponse containing items and metadata
     */
    suspend fun getCachedInventory(): InventoryResponse {
        return suspendCancellableCoroutine { continuation ->
            inventoryRef.addListenerForSingleValueEvent(object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    try {
                        val data = snapshot.value as? Map<*, *>
                        val items = data?.get("items") as? List<*>
                        val metadata = data?.get("metadata") as? Map<*, *>
                        
                        val inventoryItems = items?.mapNotNull { item ->
                            val itemMap = item as? Map<*, *>
                            itemMap?.let {
                                InventoryItem(
                                    itemId = it["item_id"] as? String ?: "",
                                    name = it["name"] as? String ?: "",
                                    sku = it["sku"] as? String ?: "",
                                    quantityAvailable = (it["available_stock"] as? Number)?.toInt() ?: 0,
                                    unit = it["unit"] as? String ?: "pcs",
                                    rate = (it["rate"] as? Number)?.toDouble() ?: 0.0
                                )
                            }
                        } ?: emptyList()
                        
                        val response = InventoryResponse(
                            items = inventoryItems,
                            metadata = metadata?.let { meta ->
                                CacheMetadata(
                                    cachedAt = meta["cached_at"] as? String ?: "",
                                    totalItems = (meta["total_items"] as? Number)?.toInt() ?: 0,
                                    source = meta["source"] as? String ?: "",
                                    cacheExpiry = meta["cache_expiry"] as? String ?: ""
                                )
                            }
                        )
                        
                        continuation.resume(response)
                    } catch (e: Exception) {
                        continuation.resumeWithException(e)
                    }
                }
                
                override fun onCancelled(error: DatabaseError) {
                    continuation.resumeWithException(error.toException())
                }
            })
            
            continuation.invokeOnCancellation {
                // Clean up if needed
            }
        }
    }
    
    /**
     * Listen to real-time inventory updates
     * @return Flow of InventoryResponse
     */
    fun listenToInventoryUpdates(): Flow<InventoryResponse> = callbackFlow {
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                try {
                    val data = snapshot.value as? Map<*, *>
                    val items = data?.get("items") as? List<*>
                    val metadata = data?.get("metadata") as? Map<*, *>
                    
                    val inventoryItems = items?.mapNotNull { item ->
                        val itemMap = item as? Map<*, *>
                        itemMap?.let {
                            InventoryItem(
                                itemId = it["item_id"] as? String ?: "",
                                name = it["name"] as? String ?: "",
                                sku = it["sku"] as? String ?: "",
                                quantityAvailable = (it["available_stock"] as? Number)?.toInt() ?: 0,
                                unit = it["unit"] as? String ?: "pcs",
                                rate = (it["rate"] as? Number)?.toDouble() ?: 0.0
                            )
                        }
                    } ?: emptyList()
                    
                    val response = InventoryResponse(
                        items = inventoryItems,
                        metadata = metadata?.let { meta ->
                            CacheMetadata(
                                cachedAt = meta["cached_at"] as? String ?: "",
                                totalItems = (meta["total_items"] as? Number)?.toInt() ?: 0,
                                source = meta["source"] as? String ?: "",
                                cacheExpiry = meta["cache_expiry"] as? String ?: ""
                            )
                        }
                    )
                    
                    trySend(response)
                } catch (e: Exception) {
                    // Handle error
                }
            }
            
            override fun onCancelled(error: DatabaseError) {
                close(error.toException())
            }
        }
        
        inventoryRef.addValueEventListener(listener)
        
        awaitClose {
            inventoryRef.removeEventListener(listener)
        }
    }
    
    /**
     * Update specific item quantity in Firebase
     * @param itemId Item ID to update
     * @param newQuantity New quantity value
     */
    suspend fun updateItemQuantity(itemId: String, newQuantity: Int): Boolean {
        return suspendCancellableCoroutine { continuation ->
            inventoryRef.child("items").addListenerForSingleValueEvent(object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    try {
                        val items = snapshot.value as? List<*>
                        val updatedItems = items?.map { item ->
                            val itemMap = item as? Map<*, *>
                            if (itemMap?.get("item_id") == itemId) {
                                itemMap.toMutableMap().apply {
                                    put("available_stock", newQuantity)
                                    put("last_modified_time", System.currentTimeMillis().toString())
                                }
                            } else {
                                itemMap
                            }
                        }
                        
                        if (updatedItems != null) {
                            inventoryRef.child("items").setValue(updatedItems)
                                .addOnSuccessListener { 
                                    continuation.resume(true)
                                }
                                .addOnFailureListener { error ->
                                    continuation.resumeWithException(error)
                                }
                        } else {
                            continuation.resume(false)
                        }
                    } catch (e: Exception) {
                        continuation.resumeWithException(e)
                    }
                }
                
                override fun onCancelled(error: DatabaseError) {
                    continuation.resumeWithException(error.toException())
                }
            })
        }
    }
    
    /**
     * Check cache status
     */
    suspend fun getCacheStatus(): CacheStatus {
        return suspendCancellableCoroutine { continuation ->
            metaRef.addListenerForSingleValueEvent(object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    try {
                        val data = snapshot.value as? Map<*, *>
                        val lastSync = data?.get("last_sync") as? Map<*, *>
                        
                        val status = CacheStatus(
                            hasCache = data != null,
                            lastSyncTimestamp = lastSync?.get("timestamp") as? String ?: "",
                            itemsCount = (lastSync?.get("items_count") as? Number)?.toInt() ?: 0
                        )
                        
                        continuation.resume(status)
                    } catch (e: Exception) {
                        continuation.resumeWithException(e)
                    }
                }
                
                override fun onCancelled(error: DatabaseError) {
                    continuation.resumeWithException(error.toException())
                }
            })
        }
    }
}

/**
 * Data classes for Firebase responses
 */
data class InventoryResponse(
    val items: List<InventoryItem>,
    val metadata: CacheMetadata? = null
)

data class CacheMetadata(
    val cachedAt: String,
    val totalItems: Int,
    val source: String,
    val cacheExpiry: String
)

data class CacheStatus(
    val hasCache: Boolean,
    val lastSyncTimestamp: String,
    val itemsCount: Int
)
