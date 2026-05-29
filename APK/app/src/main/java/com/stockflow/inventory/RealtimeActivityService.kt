package com.stockflow.inventory

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.trendstock.trendmobility.api.ActivityRequest
import com.trendstock.trendmobility.api.ApiClient
import com.trendstock.trendmobility.auth.AuthManager
import kotlinx.coroutines.*
import java.util.UUID

/**
 * RealtimeActivityService — activity logging and mirroring.
 *
 * Firestore listener removed.  Activity is now:
 *   • Written: POST /api/mobile/activity  (Railway → Supabase activity_logs)
 *   • Read:    driven by FCM push notifications from the dashboard server
 *
 * The constructor no longer accepts a FirebaseFirestore parameter —
 * callers that pass one are handled by a companion factory that ignores it.
 */
class RealtimeActivityService private constructor(private val context: Context) {

    companion object {
        private const val TAG = "RealtimeActivity"

        @Volatile private var INSTANCE: RealtimeActivityService? = null

        /** Primary factory (no Firebase). */
        fun getInstance(context: Context): RealtimeActivityService =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: RealtimeActivityService(context.applicationContext).also { INSTANCE = it }
            }

        /**
         * Legacy factory kept for callers that still pass a FirebaseFirestore argument.
         * The second argument is ignored — Firestore is no longer used.
         */
        @Suppress("UNUSED_PARAMETER")
        fun getInstance(context: Context, firestore: Any?): RealtimeActivityService =
            getInstance(context)
    }

    private val prefs:        SharedPreferences = context.getSharedPreferences("stockflow_prefs", Context.MODE_PRIVATE)
    private val serviceScope: CoroutineScope    = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val activityCallbacks = mutableListOf<(ActivityUpdate) -> Unit>()
    private var isListening       = false

    // Stable device ID (persisted across launches)
    val deviceId: String = prefs.getString("device_id", null) ?: run {
        val id = "apk_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
        prefs.edit().putString("device_id", id).apply()
        id
    }

    // ── Activity model ─────────────────────────────────────────────────────────

    data class ActivityUpdate(
        val orgId:     String,
        val userId:    String,
        val action:    String,
        val itemId:    String?  = null,
        val itemName:  String?  = null,
        val quantity:  Int?     = null,
        val timestamp: String,
        val deviceId:  String?  = null,
        val source:    String   = "unknown",
    )

    // ── Listener lifecycle ─────────────────────────────────────────────────────

    /**
     * "Start listening" — in the Supabase model push is FCM-driven, so this
     * method just marks the service as active and sets up the orgId/userId
     * context used when logging activities.  No WebSocket is opened here.
     */
    fun startActivityListener(orgId: String, currentUserId: String) {
        if (isListening) return
        isListening = true
        Log.d(TAG, "▶ Activity service active for org: $orgId")
    }

    fun stopActivityListener() {
        isListening = false
        Log.d(TAG, "⏹ Activity service stopped")
    }

    // ── Callbacks ──────────────────────────────────────────────────────────────

    fun addActivityCallback(callback: (ActivityUpdate) -> Unit) {
        activityCallbacks.add(callback)
    }

    fun removeActivityCallback(callback: (ActivityUpdate) -> Unit) {
        activityCallbacks.remove(callback)
    }

    /** Dispatch a synthetic activity update to all UI callbacks (e.g. from FCM). */
    fun dispatchActivity(update: ActivityUpdate) {
        activityCallbacks.forEach { cb ->
            try { cb(update) } catch (e: Exception) { Log.e(TAG, "Callback error: ${e.message}") }
        }
    }

    // ── Write activities to backend ────────────────────────────────────────────

    fun addActivity(
        orgId:    String,
        userId:   String,
        action:   String,
        itemId:   String? = null,
        itemName: String? = null,
        quantity: Int?    = null,
    ) {
        serviceScope.launch {
            runCatching {
                val token = AuthManager.getAccessToken()
                if (token.isNullOrBlank()) return@runCatching

                ApiClient.mobileService.logActivity(
                    auth = "Bearer $token",
                    body = ActivityRequest(
                        orgId    = orgId,
                        type     = "scan",
                        itemId   = itemId,
                        itemName = itemName,
                        quantity = quantity,
                        action   = action,
                        details  = mapOf("deviceId" to deviceId, "source" to "apk"),
                    ),
                )
                Log.d(TAG, "✅ Activity logged: $action")
            }.onFailure { Log.w(TAG, "addActivity (non-fatal): ${it.message}") }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    fun isActive(): Boolean = isListening
    fun getDeviceId(): String = deviceId

    fun cleanup() {
        stopActivityListener()
        activityCallbacks.clear()
        serviceScope.cancel()
        INSTANCE = null
    }
}
