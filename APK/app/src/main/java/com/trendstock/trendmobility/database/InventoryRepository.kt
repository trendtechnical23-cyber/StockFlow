package com.trendstock.trendmobility.database

import android.content.Context
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

class InventoryRepository(private val context: Context) {
    
    private val database = AppDatabase.getInstance(context)
    private val dao = database.inventoryDao()
    private val firestore = FirebaseFirestore.getInstance()
    private val auth = FirebaseAuth.getInstance()
    
    private var inventoryListener: ListenerRegistration? = null
    private var notificationsListener: ListenerRegistration? = null
    private var broadcastNotificationsListener: ListenerRegistration? = null
    
    companion object {
        private const val TAG = "InventoryRepository"
        private const val CACHE_VALIDITY_MS = 5 * 60 * 1000 // 5 minutes
        
        @Volatile
        private var INSTANCE: InventoryRepository? = null
        
        fun getInstance(context: Context): InventoryRepository {
            return INSTANCE ?: synchronized(this) {
                val instance = InventoryRepository(context.applicationContext)
                INSTANCE = instance
                instance
            }
        }
    }
    
    // Get all items from cache
    fun getAllItemsFlow(): Flow<List<InventoryEntity>> = dao.getAllItems()
    
    // Get item by ID from cache
    suspend fun getItemById(itemId: String): InventoryEntity? {
        return withContext(Dispatchers.IO) {
            dao.getItemById(itemId)
        }
    }
    
    // Search items in cache
    fun searchItems(query: String): Flow<List<InventoryEntity>> = dao.searchItems(query)
    
    // Check if cache is valid
    suspend fun isCacheValid(): Boolean {
        return withContext(Dispatchers.IO) {
            val lastFetch = dao.getLastFetchTime() ?: return@withContext false
            val currentTime = System.currentTimeMillis()
            (currentTime - lastFetch) < CACHE_VALIDITY_MS
        }
    }
    
    // Fetch and cache inventory from Firestore
    suspend fun refreshInventory(forceRefresh: Boolean = false): Result<Unit> {
        return withContext(Dispatchers.IO) {
            try {
                // Check if refresh is needed
                if (!forceRefresh && isCacheValid()) {
                    Log.d(TAG, "Cache is still valid, skipping refresh")
                    return@withContext Result.success(Unit)
                }
                
                val userId = auth.currentUser?.uid
                if (userId == null) {
                    Log.e(TAG, "User not authenticated")
                    return@withContext Result.failure(Exception("User not authenticated"))
                }
                
                // Get organization ID using OrganizationManager (same as FirebaseService)
                val organizationId = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId()
                
                if (organizationId.isNullOrEmpty()) {
                    Log.e(TAG, "Organization not found. User needs to login again.")
                    return@withContext Result.failure(Exception("Organization not found. Please login again."))
                }
                
                Log.d(TAG, "Fetching inventory for organization: $organizationId")
                
                // Fetch inventory from Firestore
                val inventorySnapshot = firestore
                    .collection("organizations")
                    .document(organizationId)
                    .collection("inventory")
                    .get()
                    .await()
                
                val items = inventorySnapshot.documents.mapNotNull { doc ->
                    try {
                        InventoryEntity(
                            itemId = doc.id,
                            name = doc.getString("name") ?: "",
                            sku = doc.getString("sku") ?: "",
                            quantityAvailable = (doc.getLong("stock") ?: 0).toInt(),
                            unit = doc.getString("unit"),
                            rate = doc.getDouble("price"),
                            lastFetchedAt = System.currentTimeMillis()
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Error parsing inventory item: ${doc.id}", e)
                        null
                    }
                }
                
                // Upsert: insertItems with REPLACE strategy handles both new and updated items.
                // deleteAllItems() is intentionally omitted — it was the primary performance
                // bottleneck (full delete + re-insert on EVERY change).
                dao.insertItems(items)
                
                Log.d(TAG, "✅ Successfully cached ${items.size} inventory items")
                Result.success(Unit)
                
            } catch (e: Exception) {
                Log.e(TAG, "❌ Error refreshing inventory", e)
                Result.failure(e)
            }
        }
    }
    
    // Setup real-time listeners for auto-refresh
    suspend fun setupRealtimeSync() {
        withContext(Dispatchers.IO) {
            try {
                // Prevent duplicate listeners
                if (inventoryListener != null || notificationsListener != null || broadcastNotificationsListener != null) {
                    Log.d(TAG, "Real-time sync already active, skipping setup")
                    return@withContext
                }
                
                val userId = auth.currentUser?.uid ?: return@withContext
                val organizationId = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId() ?: return@withContext
                
                var lastRefreshTime = 0L
                
                // Listen to inventory changes — apply incremental updates directly to the
                // local Room cache instead of fetching the entire collection on every change.
                // This avoids the O(N) full-reload that made the app slow for large inventories.
                inventoryListener = firestore
                    .collection("organizations")
                    .document(organizationId)
                    .collection("inventory")
                    .addSnapshotListener { snapshot, error ->
                        if (error != null) {
                            Log.e(TAG, "Inventory listener error", error)
                            return@addSnapshotListener
                        }
                        
                        if (snapshot == null || snapshot.metadata.isFromCache) return@addSnapshotListener

                        val changes = snapshot.documentChanges
                        if (changes.isEmpty()) return@addSnapshotListener

                        Log.d(TAG, "🔄 ${changes.size} inventory change(s) received, applying incrementally")
                        CoroutineScope(Dispatchers.IO).launch {
                            changes.forEach { change ->
                                val doc = change.document
                                when (change.type) {
                                    com.google.firebase.firestore.DocumentChange.Type.ADDED,
                                    com.google.firebase.firestore.DocumentChange.Type.MODIFIED -> {
                                        try {
                                            val entity = InventoryEntity(
                                                itemId = doc.id,
                                                name = doc.getString("name") ?: "",
                                                sku = doc.getString("sku") ?: "",
                                                quantityAvailable = (doc.getLong("stock") ?: 0).toInt(),
                                                unit = doc.getString("unit"),
                                                rate = doc.getDouble("price"),
                                                lastFetchedAt = System.currentTimeMillis()
                                            )
                                            dao.insertItem(entity) // REPLACE strategy upserts
                                        } catch (e: Exception) {
                                            Log.e(TAG, "Error updating cached item: ${doc.id}", e)
                                        }
                                    }
                                    com.google.firebase.firestore.DocumentChange.Type.REMOVED -> {
                                        val stub = dao.getItemById(doc.id)
                                        if (stub != null) dao.deleteItem(stub)
                                        Log.d(TAG, "Removed item from cache: ${doc.id}")
                                    }
                                }
                            }
                        }
                    }
                
                var lastNotificationRefresh = 0L
                val personalProcessed = mutableSetOf<String>()
                val broadcastProcessed = mutableSetOf<String>()
                var personalFirstLoad = true
                var broadcastFirstLoad = true
                val notificationService = com.trendstock.trendmobility.services.NotificationService.getInstance(context)
                
                // Listen to recent notifications (last 24 hours)
                val oneDayAgo = com.google.firebase.Timestamp(
                    System.currentTimeMillis() / 1000 - 86400, 
                    0
                )
                
                // Personal notifications (targeted to the signed-in user)
                notificationsListener = firestore
                    .collection("organizations")
                    .document(organizationId)
                    .collection("notifications")
                    .whereEqualTo("targetUserId", userId)
                    .whereGreaterThan("createdAt", oneDayAgo)
                    .addSnapshotListener { snapshot, error ->
                        if (error != null) {
                            Log.e(TAG, "Notifications listener error", error)
                            return@addSnapshotListener
                        }
                        
                        if (snapshot != null && !snapshot.metadata.isFromCache && !snapshot.metadata.hasPendingWrites()) {
                            if (personalFirstLoad) {
                                snapshot.documents.forEach { doc -> personalProcessed.add(doc.id) }
                                personalFirstLoad = false
                                Log.d(TAG, "📋 Personal notifications tracked: ${personalProcessed.size}")
                                return@addSnapshotListener
                            }
                            
                            var needsRefresh = false
                            snapshot.documentChanges
                                .filter { change -> 
                                    change.type == com.google.firebase.firestore.DocumentChange.Type.ADDED &&
                                    !personalProcessed.contains(change.document.id)
                                }
                                .forEach { change ->
                                    personalProcessed.add(change.document.id)
                                    val type = change.document.getString("type") ?: ""
                                    val title = change.document.getString("title") ?: "Notification"
                                    val message = change.document.getString("message") ?: ""
                                    notificationService.showSystemNotification(title, message)
                                    Log.d(TAG, "📱 Personal notification: $type - $message")
                                    if (type == "your_request_approved" || type == "your_request_rejected") {
                                        needsRefresh = true
                                    }
                                }
                            
                            if (needsRefresh) {
                                val now = System.currentTimeMillis()
                                if (now - lastNotificationRefresh > 5000) {
                                    lastNotificationRefresh = now
                                    Log.d(TAG, "📩 Personal approval update detected, refreshing cache...")
                                    CoroutineScope(Dispatchers.IO).launch {
                                        refreshInventory(forceRefresh = true)
                                    }
                                } else {
                                    Log.d(TAG, "⏭️ Skipping personal refresh (throttled)")
                                }
                            }
                        }
                    }
                
                // Broadcast notifications (targeted to ALL dashboard users)
                broadcastNotificationsListener = firestore
                    .collection("organizations")
                    .document(organizationId)
                    .collection("notifications")
                    .whereEqualTo("targetUserId", "ALL")
                    .whereGreaterThan("createdAt", oneDayAgo)
                    .addSnapshotListener { snapshot, error ->
                        if (error != null) {
                            Log.e(TAG, "Broadcast notifications listener error", error)
                            return@addSnapshotListener
                        }
                        
                        if (snapshot != null && !snapshot.metadata.isFromCache && !snapshot.metadata.hasPendingWrites()) {
                            if (broadcastFirstLoad) {
                                snapshot.documents.forEach { doc -> broadcastProcessed.add(doc.id) }
                                broadcastFirstLoad = false
                                Log.d(TAG, "📢 Broadcast notifications tracked: ${broadcastProcessed.size}")
                                return@addSnapshotListener
                            }
                            
                            snapshot.documentChanges
                                .filter { change -> 
                                    change.type == com.google.firebase.firestore.DocumentChange.Type.ADDED &&
                                    !broadcastProcessed.contains(change.document.id)
                                }
                                .forEach { change ->
                                    broadcastProcessed.add(change.document.id)
                                    val title = change.document.getString("title") ?: "System Notification"
                                    val message = change.document.getString("message") ?: ""
                                    notificationService.showSystemNotification(title, message)
                                    Log.d(TAG, "📢 Broadcast notification: $title - $message")
                                }
                        }
                    }
                
                Log.d(TAG, "✅ Real-time sync listeners established")
                
            } catch (e: Exception) {
                Log.e(TAG, "❌ Error setting up real-time sync", e)
            }
        }
    }
    
    // Stop real-time listeners
    fun stopRealtimeSync() {
        inventoryListener?.remove()
        notificationsListener?.remove()
        broadcastNotificationsListener?.remove()
        inventoryListener = null
        notificationsListener = null
        broadcastNotificationsListener = null
        Log.d(TAG, "Real-time sync listeners removed")
    }
    
    // Update item quantity in cache (optimistic update)
    suspend fun updateItemQuantity(itemId: String, newQuantity: Int) {
        withContext(Dispatchers.IO) {
            dao.updateQuantity(itemId, newQuantity)
            Log.d(TAG, "Updated quantity for item $itemId to $newQuantity")
        }
    }
    
    // Clear all cached data
    suspend fun clearCache() {
        withContext(Dispatchers.IO) {
            dao.deleteAllItems()
            Log.d(TAG, "Cache cleared")
        }
    }
    
    // Get cache statistics
    suspend fun getCacheStats(): CacheStats {
        return withContext(Dispatchers.IO) {
            CacheStats(
                itemCount = dao.getItemCount(),
                lastFetchTime = dao.getLastFetchTime(),
                isValid = isCacheValid()
            )
        }
    }
}

data class CacheStats(
    val itemCount: Int,
    val lastFetchTime: Long?,
    val isValid: Boolean
)
