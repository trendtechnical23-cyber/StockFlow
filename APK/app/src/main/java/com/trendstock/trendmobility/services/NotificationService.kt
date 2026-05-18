package com.trendstock.trendmobility.services

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.trendstock.trendmobility.R
import java.util.concurrent.atomic.AtomicInteger

class NotificationService private constructor(private val context: Context) {
    
    companion object {
        private const val CHANNEL_ID = "TrendMobility_Notifications"
        private const val CHANNEL_NAME = "Stock Alerts"
        private const val CHANNEL_DESCRIPTION = "Stock level and system notifications"

        /**
         * Each notification gets a unique ID so Android shows them as separate
         * cards in the notification shade (cascading), rather than replacing the
         * previous one.  We start above 1000 to avoid clashing with any legacy
         * static IDs that may still exist elsewhere.
         */
        private val notificationCounter = AtomicInteger(1100)
        
        @Volatile
        private var INSTANCE: NotificationService? = null
        
        fun getInstance(context: Context): NotificationService {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: NotificationService(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
    
    init {
        createNotificationChannel()
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_DEFAULT
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = CHANNEL_DESCRIPTION
            }
            
            val notificationManager: NotificationManager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }
    
    fun showStockAlert(itemName: String, alertType: String, quantity: Int) {
        val title = when (alertType) {
            "LOW_STOCK" -> "⚠️ Low Stock Alert"
            "OUT_OF_STOCK" -> "❌ Out of Stock"
            "RESTOCK" -> "✅ Restocked"
            else -> "📊 Stock Update"
        }
        
        val message = when (alertType) {
            "LOW_STOCK" -> "$itemName is running low ($quantity remaining)"
            "OUT_OF_STOCK" -> "$itemName is out of stock"
            "RESTOCK" -> "$itemName has been restocked ($quantity units)"
            else -> "$itemName: $quantity units"
        }
        
        showNotification(title, message)
    }
    
    fun showSystemNotification(title: String, message: String) {
        showNotification("🔔 $title", message)
    }
    
    fun showStockTakeNotification(sessionId: String, userEmail: String) {
        showNotification(
            "📋 Stock Take Started",
            "Stock take session initiated by $userEmail"
        )
    }
    
    /**
     * Post a notification with a unique auto-incremented ID so that multiple
     * notifications stack in the shade sorted by most-recent (Android shows them
     * newest-first by default within the same app).
     */
    private fun showNotification(title: String, message: String) {
        try {
            val notificationId = notificationCounter.getAndIncrement()
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                // Sort key ensures newest notifications appear first in the shade
                .setSortKey(System.currentTimeMillis().toString())
            
            with(NotificationManagerCompat.from(context)) {
                notify(notificationId, builder.build())
            }
        } catch (e: SecurityException) {
            // Notification permission not granted — handled gracefully
        }
    }
    
    fun areNotificationsEnabled(): Boolean {
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
}
