package com.trendstock.trendmobility.services

import android.content.Context
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.trendstock.trendmobility.api.InventoryItem

class RealTimeNotificationService private constructor(private val context: Context) {
    
    private val notificationService = NotificationService.getInstance(context)
    private val firestore = FirebaseFirestore.getInstance()
    private val lastQuantities = mutableMapOf<String, Int>()
    private var listenerRegistration: ListenerRegistration? = null
    
    companion object {
        private const val TAG = "RealTimeNotificationService"
        
        @Volatile
        private var INSTANCE: RealTimeNotificationService? = null
        
        fun getInstance(context: Context): RealTimeNotificationService {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: RealTimeNotificationService(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
    
    private var currentListenedOrgId: String? = null
    
    private fun getCurrentOrganizationId(): String? {
        return com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId()
    }
    
    /**
     * FIX APK-ISSUE-#2: Validate organization before starting listener
     * Restart listener if organization changed
     */
    fun startListening() {
        val orgId = getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.e(TAG, "No organization ID found for notifications")
            return
        }
        
        // FIX: Check if organization changed - restart listener and clear stale data
        if (currentListenedOrgId != null && currentListenedOrgId != orgId) {
            Log.d(TAG, "Organization changed ($currentListenedOrgId → $orgId), restarting listener")
            stopListening()
            lastQuantities.clear()
        }
        
        // Prevent duplicate listeners for SAME organization
        if (listenerRegistration != null && currentListenedOrgId == orgId) {
            Log.d(TAG, "Notification listener already active for org: $orgId, skipping")
            return
        }

        Log.d(TAG, "Starting notifications for organization: $orgId")
        currentListenedOrgId = orgId

        // Listen for changes in stock quantities using Firestore
        listenerRegistration = firestore.collection("organizations")
            .document(orgId)
            .collection("inventory")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Stock listener cancelled", error)
                    return@addSnapshotListener
                }
                
                snapshot?.documentChanges?.forEach { change ->
                    val data = change.document.data
                    val itemId = change.document.id
                    val name = data["name"]?.toString() ?: ""
                    val currentQty = (data["stock"] as? Number)?.toInt() ?: 0
                    
                    when (change.type) {
                        com.google.firebase.firestore.DocumentChange.Type.ADDED -> {
                            lastQuantities[itemId] = currentQty
                            Log.d(TAG, "Added stock item to tracking: $name")
                        }
                        com.google.firebase.firestore.DocumentChange.Type.MODIFIED -> {
                            val previousQty = lastQuantities[itemId] ?: 0
                            
                            if (previousQty != currentQty) {
                                Log.d(TAG, "Stock changed: $name from $previousQty to $currentQty")
                                
                                // Determine alert type and send notification
                                val alertType = when {
                                    currentQty == 0 -> "OUT_OF_STOCK"
                                    currentQty <= 5 && previousQty > 5 -> "LOW_STOCK"
                                    currentQty > previousQty -> "RESTOCK"
                                    else -> "STOCK_UPDATE"
                                }
                                
                                // Only show notification for significant changes
                                if (alertType != "STOCK_UPDATE") {
                                    val item = InventoryItem(
                                        itemId = itemId,
                                        name = name,
                                        sku = data["sku"]?.toString() ?: "",
                                        quantityAvailable = currentQty
                                    )
                                    showStockNotification(item, alertType, previousQty, currentQty)
                                }
                                
                                lastQuantities[itemId] = currentQty
                            }
                        }
                        com.google.firebase.firestore.DocumentChange.Type.REMOVED -> {
                            lastQuantities.remove(itemId)
                            Log.d(TAG, "Removed stock item from tracking: $name")
                        }
                    }
                }
            }
        
        Log.d(TAG, "Started listening for Firestore stock changes")
    }
    
    private fun showStockNotification(item: InventoryItem, alertType: String, previousQty: Int, currentQty: Int) {
        val title = when (alertType) {
            "LOW_STOCK" -> "⚠️ Low Stock Alert"
            "OUT_OF_STOCK" -> "❌ Out of Stock"
            "RESTOCK" -> "✅ Stock Updated"
            else -> "📊 Stock Change"
        }
        
        val message = when (alertType) {
            "LOW_STOCK" -> "${item.name} is running low ($currentQty remaining)"
            "OUT_OF_STOCK" -> "${item.name} is out of stock"
            "RESTOCK" -> "${item.name} updated: $previousQty → $currentQty units"
            else -> "${item.name}: $previousQty → $currentQty units"
        }
        
        notificationService.showStockAlert(item.name, alertType, currentQty)
        Log.d(TAG, "Showed notification: $title - $message")
    }
    
    fun sendTestNotification() {
        notificationService.showSystemNotification(
            "Test Notification", 
            "Inter-device notifications are working! 🎉\nTime: ${System.currentTimeMillis()}"
        )
        Log.d(TAG, "Sent test notification")
    }
    
    fun stopListening() {
        listenerRegistration?.remove()
        listenerRegistration = null
        
        clearState()
        Log.d(TAG, "Stopped listening for stock changes")
    }
    
    /**
     * FIX APK-ISSUE-#2: Clear notification state when switching organizations
     */
    fun clearState() {
        lastQuantities.clear()
        currentListenedOrgId = null
        Log.d(TAG, "Cleared notification state")
    }
}
