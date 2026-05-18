package com.stockflow.inventory

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.firebase.firestore.*
import com.google.gson.Gson
import kotlinx.coroutines.*
import java.util.*

/**
 * Real-time Activity Mirroring Service
 * Handles real-time synchronization of activity logs between APK and Dashboard
 */
class RealtimeActivityService private constructor(
    private val context: Context,
    private val firestore: FirebaseFirestore
) {
    companion object {
        private const val TAG = "RealtimeActivity"
        
        @Volatile
        private var INSTANCE: RealtimeActivityService? = null
        
        fun getInstance(context: Context, firestore: FirebaseFirestore): RealtimeActivityService {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: RealtimeActivityService(context, firestore).also { INSTANCE = it }
            }
        }
    }

    private val prefs: SharedPreferences = context.getSharedPreferences("stockflow_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    // Activity listeners
    private var activitiesListener: ListenerRegistration? = null
    private var isListening = false
    
    // Device ID for filtering self-notifications
    private val deviceId: String = generateDeviceId()
    
    // Callbacks for activity updates
    private val activityCallbacks = mutableListOf<(ActivityUpdate) -> Unit>()

    data class ActivityUpdate(
        val orgId: String,
        val userId: String,
        val action: String,
        val itemId: String? = null,
        val itemName: String? = null,
        val quantity: Int? = null,
        val timestamp: String,
        val deviceId: String? = null,
        val source: String = "unknown"
    )

    /**
     * Generate unique device ID for this APK instance
     */
    private fun generateDeviceId(): String {
        val savedDeviceId = prefs.getString("device_id", null)
        return if (savedDeviceId != null) {
            savedDeviceId
        } else {
            val newDeviceId = "apk_${System.currentTimeMillis()}_${UUID.randomUUID().toString().substring(0, 8)}"
            prefs.edit().putString("device_id", newDeviceId).apply()
            Log.d(TAG, "📱 Generated APK Device ID: $newDeviceId")
            newDeviceId
        }
    }

    /**
     * Start listening to activity changes for real-time mirroring
     */
    fun startActivityListener(orgId: String, currentUserId: String) {
        if (isListening) {
            Log.d(TAG, "🔄 Activity listener already active")
            return
        }

        Log.d(TAG, "🔥 Starting Firestore activity listener for org: $orgId")

        // Listen to org-scoped activityLogs collection
        activitiesListener = firestore
            .collection("organizations")
            .document(orgId)
            .collection("activityLogs")
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .limit(20)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "❌ Activities listener error: ${error.message}")
                    // Attempt to reconnect after 5 seconds
                    serviceScope.launch {
                        delay(5000)
                        Log.d(TAG, "🔄 Attempting to reconnect activities listener...")
                        startActivityListener(orgId, currentUserId)
                    }
                    return@addSnapshotListener
                }

                snapshot?.documentChanges?.forEach { change ->
                    if (change.type == DocumentChange.Type.ADDED) {
                        val data = change.document.data
                        val activity = ActivityUpdate(
                            orgId = data["orgId"] as? String ?: "",
                            userId = data["userId"] as? String ?: "",
                            action = data["action"] as? String ?: "",
                            itemId = data["itemId"] as? String,
                            itemName = data["itemName"] as? String,
                            quantity = (data["quantity"] as? Number)?.toInt(),
                            timestamp = data["timestamp"] as? String ?: "",
                            deviceId = data["deviceId"] as? String,
                            source = data["source"] as? String ?: "unknown"
                        )

                        // Filter out self-notifications (ignore activities from this APK)
                        if (activity.deviceId == deviceId) {
                            Log.d(TAG, "🔇 Ignoring self-notification from APK")
                            return@forEach
                        }

                        // Filter by organization (additional security)
                        if (activity.orgId != orgId) {
                            Log.d(TAG, "🚫 Ignoring activity from different organization")
                            return@forEach
                        }

                        Log.d(TAG, "🖥️ New activity from ${activity.source}: ${activity.action}")
                        
                        // Notify all registered callbacks
                        activityCallbacks.forEach { callback ->
                            try {
                                callback(activity)
                            } catch (e: Exception) {
                                Log.e(TAG, "❌ Error in activity callback: ${e.message}")
                            }
                        }
                    }
                }
            }

        isListening = true
        Log.d(TAG, "✅ Activity listener started for org: $orgId")
    }

    /**
     * Stop activity listener
     */
    fun stopActivityListener() {
        Log.d(TAG, "🛑 Stopping activity listener...")
        
        activitiesListener?.remove()
        activitiesListener = null
        isListening = false
        
        Log.d(TAG, "✅ Activity listener stopped")
    }

    /**
     * Add activity callback for UI updates
     */
    fun addActivityCallback(callback: (ActivityUpdate) -> Unit) {
        activityCallbacks.add(callback)
    }

    /**
     * Remove activity callback
     */
    fun removeActivityCallback(callback: (ActivityUpdate) -> Unit) {
        activityCallbacks.remove(callback)
    }

    /**
     * Add new activity (from APK to Dashboard)
     */
    fun addActivity(
        orgId: String,
        userId: String,
        action: String,
        itemId: String? = null,
        itemName: String? = null,
        quantity: Int? = null
    ) {
        serviceScope.launch {
            try {
                val activity = mapOf(
                    "orgId" to orgId,
                    "userId" to userId,
                    "action" to action,
                    "itemId" to itemId,
                    "itemName" to itemName,
                    "quantity" to quantity,
                    "timestamp" to Date().toString(),
                    "deviceId" to deviceId,
                    "source" to "apk"
                )

                Log.d(TAG, "📤 Adding APK activity to Firestore: $action")
                
                firestore
                    .collection("organizations")
                    .document(orgId)
                    .collection("activityLogs")
                    .add(activity)
                    .addOnSuccessListener { documentRef ->
                        Log.d(TAG, "✅ Activity added successfully: ${documentRef.id}")
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "❌ Failed to add activity: ${e.message}")
                    }

            } catch (e: Exception) {
                Log.e(TAG, "❌ Error adding activity: ${e.message}")
            }
        }
    }

    /**
     * Get device ID
     */
    fun getDeviceId(): String = deviceId

    /**
     * Check if listener is active
     */
    fun isActive(): Boolean = isListening

    /**
     * Cleanup resources
     */
    fun cleanup() {
        Log.d(TAG, "🧹 Cleaning up RealtimeActivityService...")
        
        stopActivityListener()
        activityCallbacks.clear()
        serviceScope.cancel()
        
        Log.d(TAG, "✅ RealtimeActivityService cleanup complete")
    }
}