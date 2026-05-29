package com.trendstock.trendmobility.services

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.trendstock.trendmobility.MainActivity
import com.trendstock.trendmobility.R
import com.trendstock.trendmobility.api.ApiClient
import com.trendstock.trendmobility.api.FcmRegistrationRequest
import com.trendstock.trendmobility.auth.AuthManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class StockFlowMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FCM_SERVICE"
        private const val NOTIFICATION_ID_BASE = 1000

        // ── Channel IDs ──────────────────────────────────────────────────────
        // NOTE: Android caches a channel's sound at creation time and ignores
        // later setSound() calls. If you change a channel's sound, you MUST bump
        // the version suffix below so a brand-new channel is created.
        private const val CH_VER = "v3"
        const val CHANNEL_STOCK_TAKE   = "ch_stock_take_$CH_VER"
        const val CHANNEL_LOW_STOCK    = "ch_low_stock_$CH_VER"
        const val CHANNEL_APPROVAL     = "ch_approval_$CH_VER"
        const val CHANNEL_STOCK_IN_OUT = "ch_stock_in_out_$CH_VER"
        const val CHANNEL_GENERAL      = "ch_general_$CH_VER"

        // Legacy channel IDs to delete on upgrade (old sounds/icons)
        private val LEGACY_CHANNELS = listOf(
            "stockflow_notifications", "TrendMobility_Notifications",
            "ch_stock_take", "ch_low_stock", "ch_approval", "ch_stock_in_out", "ch_general"
        )

        /**
         * Creates (or refreshes) all notification channels.
         * Safe to call from any Context — used by both this service and
         * NotificationService so channel/sound config stays in one place.
         */
        fun createNotificationChannels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(NotificationManager::class.java) ?: return

            // Remove stale channels (old IDs / old sounds)
            LEGACY_CHANNELS.forEach { id ->
                try { nm.deleteNotificationChannel(id) } catch (_: Exception) {}
            }

            val audioAttrs = android.media.AudioAttributes.Builder()
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                .build()

            val pkg = context.packageName
            fun rawUri(resId: Int): Uri = Uri.parse("android.resource://$pkg/$resId")

            NotificationChannel(CHANNEL_STOCK_TAKE, "Stock Take", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Stock take session start, scan, and end alerts"
                enableVibration(true); vibrationPattern = longArrayOf(0, 200, 100, 200)
                enableLights(true); lightColor = android.graphics.Color.parseColor("#6366F1")
                setSound(rawUri(R.raw.sound_stock_take_start), audioAttrs)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }.also { nm.createNotificationChannel(it) }

            NotificationChannel(CHANNEL_LOW_STOCK, "Stock Alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Low stock and out-of-stock warnings"
                enableVibration(true); vibrationPattern = longArrayOf(0, 300, 150, 300)
                enableLights(true); lightColor = android.graphics.Color.parseColor("#EF4444")
                setSound(rawUri(R.raw.sound_low_stock), audioAttrs)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }.also { nm.createNotificationChannel(it) }

            NotificationChannel(CHANNEL_APPROVAL, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Stock change approval requests and outcomes"
                enableVibration(true); vibrationPattern = longArrayOf(0, 200, 100, 200)
                enableLights(true); lightColor = android.graphics.Color.parseColor("#F59E0B")
                setSound(rawUri(R.raw.sound_approval_pending), audioAttrs)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }.also { nm.createNotificationChannel(it) }

            NotificationChannel(CHANNEL_STOCK_IN_OUT, "Inventory Updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Stock-in and stock-out inventory movements"
                enableVibration(true); vibrationPattern = longArrayOf(0, 150, 100, 150)
                enableLights(true); lightColor = android.graphics.Color.parseColor("#10B981")
                setSound(rawUri(R.raw.sound_confirmation), audioAttrs)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }.also { nm.createNotificationChannel(it) }

            NotificationChannel(CHANNEL_GENERAL, "General", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "General app and system notifications"
                enableVibration(true); vibrationPattern = longArrayOf(0, 150)
                enableLights(true); lightColor = android.graphics.Color.parseColor("#6366F1")
                setSound(rawUri(R.raw.sound_notification), audioAttrs)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }.also { nm.createNotificationChannel(it) }

            Log.d(TAG, "All notification channels created ($CH_VER)")
        }

        // ── Notification types (match server payload) ─────────────────────
        const val TYPE_STOCK_LOW        = "stock_low"
        const val TYPE_STOCK_OUT        = "stock_out"
        const val TYPE_STOCK_IN         = "stock_in"
        const val TYPE_STOCK_UPDATE     = "stock_update"
        const val TYPE_SYSTEM           = "system"
        const val TYPE_ACTIVITY         = "activity"
        const val TYPE_STOCK_TAKE_START = "STOCK_TAKE_START"
        const val TYPE_STOCK_TAKE_END   = "STOCK_TAKE_END"
        const val TYPE_STOCK_TAKE_SCAN  = "STOCK_TAKE_SCAN"
        const val TYPE_APPROVAL_PENDING = "approval_pending"
        const val TYPE_APPROVED         = "approved"
        const val TYPE_REJECTED         = "rejected"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels(this)
        Log.d(TAG, "StockFlowMessagingService started")
    }

    // ── Token handling ────────────────────────────────────────────────────────

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token generated")
        storeTokenInFirestore(token)
    }

    // ── Message handling ──────────────────────────────────────────────────────

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "FCM message received from: ${remoteMessage.from}")

        if (remoteMessage.data.isNotEmpty()) {
            handleDataMessage(remoteMessage.data)
        } else {
            remoteMessage.notification?.let { n ->
                showNotification(
                    title      = n.title ?: "StockFlow",
                    body       = n.body  ?: "",
                    data       = remoteMessage.data,
                    channelId  = CHANNEL_GENERAL
                )
            }
        }
    }

    private fun handleDataMessage(data: Map<String, String>) {
        val type      = data["type"] ?: TYPE_SYSTEM
        val title     = data["title"] ?: getDefaultTitle(type)
        val body      = data["body"]  ?: ""
        val itemName  = data["item_name"] ?: data["itemName"]
        val quantity  = data["quantity"]
        val stockLevel= data["stock_level"]
        val now       = formatTimestamp(System.currentTimeMillis())

        val (customBody, channelId) = when (type) {

            TYPE_STOCK_TAKE_START -> {
                val startedBy  = data["startedBy"] ?: "A team member"
                val deviceName = data["deviceName"] ?: data["device"] ?: "Mobile device"
                val sessionId  = data["sessionId"]
                val orgId      = data["organizationId"] ?: data["orgId"]

                if (sessionId != null && orgId != null) {
                    storeActiveStockTakeSession(sessionId, orgId)
                }

                "$startedBy started a stock take on $deviceName at $now. Tap to join the session." to CHANNEL_STOCK_TAKE
            }

            TYPE_STOCK_TAKE_END -> {
                val endedBy    = data["endedBy"] ?: "A team member"
                val deviceName = data["deviceName"] ?: data["device"] ?: "Mobile device"
                clearActiveStockTakeSession()
                "$endedBy completed the stock take on $deviceName at $now." to CHANNEL_STOCK_TAKE
            }

            TYPE_STOCK_TAKE_SCAN -> {
                val prefs = getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
                if (prefs.getString("activeStockTakeSessionId", null) == null) return
                "Item scanned: ${itemName ?: "Unknown item"}" to CHANNEL_STOCK_TAKE
            }

            TYPE_STOCK_LOW ->
                "Low stock alert: ${itemName ?: "An item"} is running low — ${stockLevel ?: "0"} units remaining." to CHANNEL_LOW_STOCK

            TYPE_STOCK_OUT ->
                "${itemName ?: "An item"} is out of stock. Restock needed immediately." to CHANNEL_LOW_STOCK

            TYPE_STOCK_IN -> {
                val qty = quantity ?: "Some"
                "$qty units of ${itemName ?: "an item"} added to inventory at $now." to CHANNEL_STOCK_IN_OUT
            }

            TYPE_STOCK_UPDATE ->
                "${itemName ?: "Item"} stock level updated to ${stockLevel ?: "unknown"} units." to CHANNEL_STOCK_IN_OUT

            TYPE_APPROVAL_PENDING ->
                (if (body.isNotEmpty()) body else "A stock change is awaiting your approval.") to CHANNEL_APPROVAL

            TYPE_APPROVED ->
                (if (body.isNotEmpty()) body else "Stock change approved and applied to inventory.") to CHANNEL_APPROVAL

            TYPE_REJECTED ->
                (if (body.isNotEmpty()) body else "Stock change request was declined.") to CHANNEL_APPROVAL

            TYPE_ACTIVITY -> {
                if (body.isEmpty()) return
                body to CHANNEL_GENERAL
            }

            else -> {
                if (body.isEmpty()) return
                body to CHANNEL_GENERAL
            }
        }

        showNotification(title, customBody, data, channelId)
    }

    // ── Show notification ─────────────────────────────────────────────────────

    private fun showNotification(
        title     : String,
        body      : String,
        data      : Map<String, String> = emptyMap(),
        channelId : String = CHANNEL_GENERAL
    ) {
        val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            data.forEach { (k, v) -> putExtra(k, v) }
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // Small icon MUST be a transparent white silhouette (Android only reads
        // its alpha channel). The full-colour logo is used as the large icon.
        val largeIcon = try {
            android.graphics.BitmapFactory.decodeResource(resources, R.drawable.stockflowlogo)
        } catch (e: Exception) { null }

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .also { if (largeIcon != null) it.setLargeIcon(largeIcon) }
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(getChannelPriority(channelId))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 200, 100, 200))
            .setColor(getNotificationColor(data["type"]))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()

        notificationManager.notify(generateNotificationId(data), notification)
        Log.d(TAG, "Notification shown [$channelId]: $title")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun getDefaultTitle(type: String): String = when (type) {
        TYPE_STOCK_LOW        -> "Low Stock Alert"
        TYPE_STOCK_OUT        -> "Out of Stock"
        TYPE_STOCK_IN         -> "Stock Added"
        TYPE_STOCK_UPDATE     -> "Inventory Updated"
        TYPE_ACTIVITY         -> "Activity Update"
        TYPE_STOCK_TAKE_START -> "Stock Take Started"
        TYPE_STOCK_TAKE_END   -> "Stock Take Completed"
        TYPE_STOCK_TAKE_SCAN  -> "Item Scanned"
        TYPE_APPROVAL_PENDING -> "Approval Required"
        TYPE_APPROVED         -> "Stock Change Approved"
        TYPE_REJECTED         -> "Stock Change Declined"
        else                  -> "StockFlow"
    }

    private fun getChannelPriority(channelId: String): Int = when (channelId) {
        CHANNEL_LOW_STOCK, CHANNEL_STOCK_TAKE, CHANNEL_APPROVAL -> NotificationCompat.PRIORITY_HIGH
        else -> NotificationCompat.PRIORITY_DEFAULT
    }

    private fun getNotificationColor(type: String?): Int = when (type) {
        TYPE_STOCK_LOW, TYPE_STOCK_OUT        -> android.graphics.Color.parseColor("#EF4444") // Red
        TYPE_STOCK_IN                          -> android.graphics.Color.parseColor("#10B981") // Green
        TYPE_STOCK_UPDATE                      -> android.graphics.Color.parseColor("#3B82F6") // Blue
        TYPE_STOCK_TAKE_START,
        TYPE_STOCK_TAKE_END,
        TYPE_STOCK_TAKE_SCAN                  -> android.graphics.Color.parseColor("#6366F1") // Indigo
        TYPE_APPROVAL_PENDING                  -> android.graphics.Color.parseColor("#F59E0B") // Amber
        TYPE_APPROVED                          -> android.graphics.Color.parseColor("#10B981") // Green
        TYPE_REJECTED                          -> android.graphics.Color.parseColor("#EF4444") // Red
        else                                   -> android.graphics.Color.parseColor("#6366F1") // Default indigo
    }

    private fun generateNotificationId(data: Map<String, String>): Int {
        val type      = data["type"] ?: "default"
        val itemName  = data["item_name"] ?: ""
        val timestamp = System.currentTimeMillis()
        return (type + itemName + timestamp).hashCode()
    }

    /** Format epoch millis as "dd MMM yyyy, HH:mm" e.g. "21 May 2026, 14:30" */
    private fun formatTimestamp(epochMs: Long): String {
        return try {
            SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault()).format(Date(epochMs))
        } catch (e: Exception) {
            ""
        }
    }

    // ── Session helpers ───────────────────────────────────────────────────────

    private fun storeActiveStockTakeSession(sessionId: String, orgId: String) {
        getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE).edit()
            .putString("activeStockTakeSessionId", sessionId)
            .putString("activeStockTakeOrgId", orgId)
            .putLong("sessionStartTime", System.currentTimeMillis())
            .apply()

        val intent = Intent("com.trendstock.STOCK_TAKE_SESSION_CHANGED").apply {
            putExtra("sessionActive", true)
            putExtra("sessionId", sessionId)
            putExtra("orgId", orgId)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            sendBroadcast(intent, null)
        } else {
            intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
            sendBroadcast(intent)
        }
        Log.d(TAG, "Active session stored: $sessionId")
    }

    private fun clearActiveStockTakeSession() {
        getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE).edit()
            .remove("activeStockTakeSessionId")
            .remove("activeStockTakeOrgId")
            .remove("sessionStartTime")
            .apply()

        val intent = Intent("com.trendstock.STOCK_TAKE_SESSION_CHANGED").apply {
            putExtra("sessionActive", false)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            sendBroadcast(intent, null)
        } else {
            intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
            sendBroadcast(intent)
        }
        Log.d(TAG, "Active session cleared")
    }

    fun hasActiveStockTakeSession(): Boolean {
        return getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
            .contains("activeStockTakeSessionId")
    }

    fun getActiveStockTakeSessionId(): String? {
        return getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
            .getString("activeStockTakeSessionId", null)
    }

    // ── FCM token storage via backend API ─────────────────────────────────────

    private fun storeTokenInFirestore(token: String) {
        // Renamed for API compatibility. Delegates to the backend (/api/devices/register).
        val orgId = getSharedPreferences("StockFlowPrefs", MODE_PRIVATE)
            .getString("organizationId", null) ?: return

        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                val accessToken = AuthManager.getAccessToken() ?: return@runCatching
                ApiClient.mobileService.registerFcmToken(
                    auth = "Bearer $accessToken",
                    body = FcmRegistrationRequest(token, "android", orgId),
                )
                Log.d(TAG, "FCM token stored via backend for ${Build.MODEL}")
            }.onFailure { Log.w(TAG, "FCM token store (non-fatal): ${it.message}") }
        }
    }

    fun deleteTokenFromFirestore() {
        FCMTokenManager.getInstance(this).clearToken()
    }
}
