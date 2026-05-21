package com.trendstock.trendmobility.services

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.trendstock.trendmobility.R
import java.util.concurrent.atomic.AtomicInteger

/**
 * NotificationService — local (non-FCM) push notifications.
 *
 * Uses the channels declared by StockFlowMessagingService so that sound
 * settings are consistent across FCM and local notifications.
 */
class NotificationService private constructor(private val context: Context) {

    companion object {
        /**
         * Each notification gets a unique ID so Android stacks them in the
         * shade rather than replacing the previous one.
         * Start above 2000 to avoid collisions with FCM notification IDs.
         */
        private val notificationCounter = AtomicInteger(2100)

        @Volatile
        private var INSTANCE: NotificationService? = null

        fun getInstance(context: Context): NotificationService =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: NotificationService(context.applicationContext).also { INSTANCE = it }
            }
    }

    init {
        // Channels are created by StockFlowMessagingService.createNotificationChannels().
        // We call ensureChannels() here as a safety net in case this service is
        // used before the FCM service has ever started (e.g. first launch).
        ensureChannels()
    }

    /**
     * Create channels if they don't exist yet.
     * Delegates to the single shared definition in StockFlowMessagingService
     * so channel/sound config lives in exactly one place.
     */
    private fun ensureChannels() {
        StockFlowMessagingService.createNotificationChannels(context)
    }

    // ── Public API ────────────────────────────────────────────────────────────

    fun showStockAlert(itemName: String, alertType: String, quantity: Int) {
        val (title, message, channelId) = when (alertType) {
            "LOW_STOCK"    -> Triple(
                "Low Stock Alert",
                "$itemName is running low — $quantity units remaining.",
                StockFlowMessagingService.CHANNEL_LOW_STOCK
            )
            "OUT_OF_STOCK" -> Triple(
                "Out of Stock",
                "$itemName is out of stock. Restock needed immediately.",
                StockFlowMessagingService.CHANNEL_LOW_STOCK
            )
            "RESTOCK"      -> Triple(
                "Stock Replenished",
                "$itemName has been restocked — $quantity units now available.",
                StockFlowMessagingService.CHANNEL_STOCK_IN_OUT
            )
            else           -> Triple(
                "Inventory Update",
                "$itemName: $quantity units.",
                StockFlowMessagingService.CHANNEL_GENERAL
            )
        }
        showNotification(title, message, channelId)
    }

    fun showSystemNotification(title: String, message: String) {
        showNotification(title, message, StockFlowMessagingService.CHANNEL_GENERAL)
    }

    fun showStockTakeNotification(sessionId: String, userName: String) {
        showNotification(
            title     = "Stock Take Started",
            message   = "$userName started a new stock take session.",
            channelId = StockFlowMessagingService.CHANNEL_STOCK_TAKE
        )
    }

    fun showApprovalNotification(title: String, message: String) {
        showNotification(title, message, StockFlowMessagingService.CHANNEL_APPROVAL)
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private fun showNotification(title: String, message: String, channelId: String) {
        try {
            val notificationId = notificationCounter.getAndIncrement()
            // Small icon must be a transparent white silhouette; logo is the large icon.
            val largeIcon = try {
                android.graphics.BitmapFactory.decodeResource(context.resources, R.drawable.stockflowlogo)
            } catch (e: Exception) { null }

            val builder = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .also { if (largeIcon != null) it.setLargeIcon(largeIcon) }
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(
                    if (channelId == StockFlowMessagingService.CHANNEL_LOW_STOCK ||
                        channelId == StockFlowMessagingService.CHANNEL_STOCK_TAKE ||
                        channelId == StockFlowMessagingService.CHANNEL_APPROVAL)
                        NotificationCompat.PRIORITY_HIGH
                    else
                        NotificationCompat.PRIORITY_DEFAULT
                )
                .setAutoCancel(true)
                .setSortKey(System.currentTimeMillis().toString())

            NotificationManagerCompat.from(context).notify(notificationId, builder.build())
        } catch (_: SecurityException) {
            // Notification permission not granted — fail silently
        }
    }

    fun areNotificationsEnabled(): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()
}
