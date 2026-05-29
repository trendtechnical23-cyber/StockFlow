package com.trendstock.trendmobility.services

import android.content.Context
import android.util.Log
import com.trendstock.trendmobility.utils.OrganizationManager

/**
 * RealTimeNotificationService — stock alert notifications.
 *
 * Firestore snapshot listener removed. Stock-level alerts are now delivered
 * exclusively via Firebase Cloud Messaging (FCM) push notifications sent by
 * the Railway backend (server/routes/notify.js) when thresholds are breached.
 *
 * This class is retained so all existing callers compile without changes.
 * The lifecycle methods (startListening / stopListening) are no-ops — FCM
 * handles delivery regardless of whether the app is in the foreground.
 */
class RealTimeNotificationService private constructor(private val context: Context) {

    private val notificationService = NotificationService.getInstance(context)

    companion object {
        private const val TAG = "RealTimeNotificationService"

        @Volatile private var INSTANCE: RealTimeNotificationService? = null

        fun getInstance(context: Context): RealTimeNotificationService =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: RealTimeNotificationService(context.applicationContext).also { INSTANCE = it }
            }
    }

    private var currentOrgId: String? = null

    // ── Lifecycle (no-ops — FCM handles delivery) ─────────────────────────────

    fun startListening() {
        val orgId = OrganizationManager.getCurrentOrganizationId()
        if (!orgId.isNullOrBlank()) {
            currentOrgId = orgId
            Log.d(TAG, "▶ Notification service active for org: $orgId (FCM-driven)")
        }
    }

    fun stopListening() {
        currentOrgId = null
        Log.d(TAG, "⏹ Notification service stopped")
    }

    fun clearState() {
        currentOrgId = null
    }

    // ── Test notification ─────────────────────────────────────────────────────

    fun sendTestNotification() {
        notificationService.showSystemNotification(
            "Test Notification",
            "Inter-device notifications are working! 🎉\nTime: ${System.currentTimeMillis()}",
        )
        Log.d(TAG, "Test notification shown")
    }
}
