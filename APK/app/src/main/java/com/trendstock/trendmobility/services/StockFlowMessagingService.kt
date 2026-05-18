package com.trendstock.trendmobility.services

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.trendstock.trendmobility.MainActivity
import com.trendstock.trendmobility.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class StockFlowMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "FCM_SERVICE"
        private const val CHANNEL_ID = "stockflow_notifications"
        private const val CHANNEL_NAME = "StockFlow Notifications"
        private const val CHANNEL_DESCRIPTION = "Notifications for inventory and stock updates"
        private const val NOTIFICATION_ID_BASE = 1000
        
        // Notification types
        const val TYPE_STOCK_LOW = "stock_low"
        const val TYPE_STOCK_OUT = "stock_out"
        const val TYPE_STOCK_IN = "stock_in"
        const val TYPE_STOCK_UPDATE = "stock_update"
        const val TYPE_SYSTEM = "system"
        const val TYPE_ACTIVITY = "activity"
        const val TYPE_STOCK_TAKE_START = "STOCK_TAKE_START"
        const val TYPE_STOCK_TAKE_END = "STOCK_TAKE_END"
        const val TYPE_STOCK_TAKE_SCAN = "STOCK_TAKE_SCAN"
    }

    private val firestore = FirebaseFirestore.getInstance()
    private val database = FirebaseDatabase.getInstance()
    private val auth = FirebaseAuth.getInstance()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        Log.d(TAG, "StockFlowMessagingService created")
    }

    /**
     * Called when a new FCM token is generated
     * This happens on app first install, app restore, app update, or token refresh
     */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "🔑 NEW FCM TOKEN GENERATED")
        Log.d(TAG, "🔑 Token: $token")
        
        // Store the token in Firestore
        storeTokenInFirestore(token)
        
        // Send token to your server if needed
        sendTokenToServer(token)
    }

    /**
     * Called when a message is received while the app is in the foreground
     * For background messages, the system handles them automatically
     */
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        
        Log.d(TAG, "🔔 FCM MESSAGE RECEIVED from: ${remoteMessage.from}")
        Log.d(TAG, "🔔 Message ID: ${remoteMessage.messageId}")
        Log.d(TAG, "🔔 Message Type: ${remoteMessage.messageType}")
        
        // Check if message contains data payload
        if (remoteMessage.data.isNotEmpty()) {
            Log.d(TAG, "📨 Message data payload: ${remoteMessage.data}")
            val notificationType = remoteMessage.data["type"] ?: "unknown"
            Log.d(TAG, "📨 Notification type: $notificationType")
            
            // Handle data message and SKIP the automatic notification payload
            // This prevents duplicate notifications
            handleDataMessage(remoteMessage.data)
        } else {
            Log.d(TAG, "⚠️ No data payload in FCM message")
            
            // Only show notification from notification payload if no data payload exists
            remoteMessage.notification?.let { notification ->
                Log.d(TAG, "Message Notification Body: ${notification.body}")
                showNotification(
                    title = notification.title ?: "StockFlow",
                    body = notification.body ?: "",
                    data = remoteMessage.data
                )
            }
        }
    }

    /**
     * Handle data-only messages (no notification payload)
     */
    private fun handleDataMessage(data: Map<String, String>) {
        val notificationType = data["type"] ?: TYPE_SYSTEM
        // Use notification payload title if available, otherwise use data title, fallback to default
        val title = data["title"] ?: getDefaultTitle(notificationType)
        val body = data["body"] ?: ""  // Removed default "You have a new update" to eliminate redundant messages
        val itemName = data["item_name"] ?: data["itemName"]
        val quantity = data["quantity"]
        val stockLevel = data["stock_level"]
        
        Log.d(TAG, "🔍 Processing notification data: type=$notificationType, title=$title, body=$body")
        
        // Create custom notification content based on type
        val customBody = when (notificationType) {
            TYPE_STOCK_LOW -> "⚠️ Low Stock Alert: ${itemName ?: "Unknown item"} is running low (${stockLevel ?: "0"} remaining)"
            TYPE_STOCK_OUT -> "🚨 Out of Stock: ${itemName ?: "Unknown item"} is out of stock!"
            TYPE_STOCK_IN -> "📦 Stock Added: ${quantity ?: "Items"} units of ${itemName ?: "Unknown item"} added to inventory"
            TYPE_STOCK_UPDATE -> "📊 Inventory Update: ${itemName ?: "Item"} stock level updated to ${stockLevel ?: "unknown"}"
            TYPE_ACTIVITY -> if (body.isNotEmpty()) "📋 Activity Log: $body" else return // Skip showing empty activity logs
            TYPE_STOCK_TAKE_START -> {
                val startedBy = data["startedBy"] ?: "Someone"
                val sessionId = data["sessionId"]
                val orgId = data["organizationId"] ?: data["orgId"]
                
                Log.d(TAG, "📋 Stock Take Start - startedBy: $startedBy, sessionId: $sessionId, orgId: $orgId")
                
                if (sessionId != null && orgId != null) {
                    storeActiveStockTakeSession(sessionId, orgId)
                }
                
                "📋 Stock Take Started by $startedBy. Tap to join the session!"
            }
            TYPE_STOCK_TAKE_END -> {
                val endedBy = data["endedBy"] ?: "Someone"
                clearActiveStockTakeSession()
                "📋 Stock Take Completed by $endedBy. Session has ended."
            }
            TYPE_STOCK_TAKE_SCAN -> {
                // Only show scan notifications if session is active
                val sharedPrefs = this.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
                val activeSessionId = sharedPrefs.getString("activeStockTakeSessionId", null)
                if (activeSessionId == null) {
                    Log.d(TAG, "� Ignoring stock take scan notification as no active session exists")
                    return // Don't show scan notifications if no active session
                }
                "�📋 Item scanned in stock take session: ${itemName ?: "Unknown item"}"
            }
            else -> {
                if (body.isEmpty()) return // Skip notifications with empty body
                body
            }
        }
        
        // Log notification details for debugging
        Log.d(TAG, "🔔 Processing notification - Type: $notificationType, Title: $title")
        
        showNotification(title, customBody, data)
    }

    /**
     * Show notification to user
     */
    private fun showNotification(title: String, body: String, data: Map<String, String> = emptyMap()) {
        val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        
        // Create intent for when notification is tapped
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            // Add data to intent if needed
            data.forEach { (key, value) ->
                putExtra(key, value)
            }
        }
        
        val pendingIntent = PendingIntent.getActivity(
            this, 
            0, 
            intent, 
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        
        // Get notification icon based on type
        val iconRes = getNotificationIcon(data["type"])
        
        // Build notification with MAX priority for instant delivery
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(iconRes)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX) // MAX priority for instant delivery
            .setCategory(NotificationCompat.CATEGORY_MESSAGE) // Treated as high-priority message
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 250, 250, 250))
            .setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION))
            .setColor(getNotificationColor(data["type"]))
            .setDefaults(android.app.Notification.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
        
        // Generate unique notification ID based on content
        val notificationId = generateNotificationId(data)
        
        notificationManager.notify(notificationId, notification)
        
        Log.d(TAG, "Notification shown: $title - $body")
    }

    /**
     * Create notification channel (required for Android 8.0+)
     */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = CHANNEL_DESCRIPTION
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 250, 250)
                enableLights(true)
                lightColor = android.graphics.Color.parseColor("#6A1B9A")
                // Set custom sound for instant recognition
                setSound(
                    android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                    android.media.AudioAttributes.Builder()
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                        .build()
                )
                // Ensure notifications bypass Do Not Disturb for critical stock updates
                setBypassDnd(true)
                // Show on lockscreen for immediate visibility
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
            
            Log.d(TAG, "Notification channel created: $CHANNEL_ID")
        }
    }

    /**
     * Store FCM token in Firestore under user's document
     */
    private fun storeTokenInFirestore(token: String) {
        val user = auth.currentUser
        if (user == null) {
            Log.w(TAG, "No authenticated user, cannot store FCM token")
            return
        }
        
        val organizationId = getOrganizationId()
        if (organizationId == null) {
            Log.w(TAG, "No organization ID found, cannot store FCM token")
            return
        }
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Store in Realtime Database under /deviceTokens/{uid} as required by backend
                val realtimeRef = database.getReference("deviceTokens").child(user.uid)
                realtimeRef.setValue(token).await()
                Log.d(TAG, "✅ FCM token stored in Realtime Database at /deviceTokens/${user.uid}")
                
                // Also store in Firestore for organization management
                val userDocRef = firestore
                    .collection("organizations")
                    .document(organizationId)
                    .collection("users")
                    .document(user.uid)
                
                // Update the fcmToken field
                userDocRef.update(
                    mapOf(
                        "fcmToken" to token,
                        "tokenUpdatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                        "deviceInfo" to mapOf(
                            "platform" to "android",
                            "appVersion" to getAppVersion(),
                            "deviceModel" to Build.MODEL,
                            "androidVersion" to Build.VERSION.RELEASE
                        )
                    )
                ).await()
                
                Log.d(TAG, "✅ FCM token successfully stored in Firestore")
                
            } catch (e: Exception) {
                Log.e(TAG, "Failed to store FCM token in Firestore", e)
                
                // Try to create the user document if it doesn't exist
                try {
                    // Ensure Realtime Database token is set even if Firestore fails
                    val realtimeRef = database.getReference("deviceTokens").child(user.uid)
                    realtimeRef.setValue(token).await()
                    Log.d(TAG, "✅ FCM token stored in Realtime Database (fallback)")
                    
                    val userDocRef = firestore
                        .collection("organizations")
                        .document(organizationId)
                        .collection("users")
                        .document(user.uid)
                    
                    userDocRef.set(
                        mapOf(
                            "email" to user.email,
                            "fcmToken" to token,
                            "tokenUpdatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                            "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                            "deviceInfo" to mapOf(
                                "platform" to "android",
                                "appVersion" to getAppVersion(),
                                "deviceModel" to Build.MODEL,
                                "androidVersion" to Build.VERSION.RELEASE
                            )
                        )
                    ).await()
                    
                    Log.d(TAG, "✅ User document created with FCM token")
                } catch (createException: Exception) {
                    Log.e(TAG, "Failed to create user document with FCM token", createException)
                }
            }
        }
    }

    /**
     * Send token to your backend server (if you have one)
     */
    private fun sendTokenToServer(token: String) {
        // Implement this if you want to send the token to your backend server
        // For now, we're storing it in Firestore which is accessible by the web dashboard
        Log.d(TAG, "Token stored in Firestore, available for web dashboard")
    }

    /**
     * Get organization ID from SharedPreferences or user profile
     */
    private fun getOrganizationId(): String? {
        val sharedPref = getSharedPreferences("StockFlowPrefs", MODE_PRIVATE)
        return sharedPref.getString("organizationId", null)
    }

    /**
     * Get app version
     */
    private fun getAppVersion(): String {
        return try {
            val packageInfo = packageManager.getPackageInfo(packageName, 0)
            packageInfo.versionName ?: "1.0"
        } catch (e: Exception) {
            "1.0"
        }
    }

    /**
     * Get default title based on notification type
     */
    private fun getDefaultTitle(type: String): String {
        return when (type) {
            TYPE_STOCK_LOW -> "Low Stock Alert"
            TYPE_STOCK_OUT -> "Out of Stock"
            TYPE_STOCK_IN -> "Stock Added"
            TYPE_STOCK_UPDATE -> "Inventory Updated"
            TYPE_ACTIVITY -> "Activity Update"
            TYPE_STOCK_TAKE_START -> "📋 Stock Take Started"
            TYPE_STOCK_TAKE_END -> "📋 Stock Take Completed"
            TYPE_STOCK_TAKE_SCAN -> "📋 Item Scanned"
            else -> "StockFlow"
        }
    }

    /**
     * Get notification icon based on type
     */
    private fun getNotificationIcon(type: String?): Int {
        return when (type) {
            TYPE_STOCK_LOW, TYPE_STOCK_OUT -> R.drawable.ic_warning
            TYPE_STOCK_IN -> R.drawable.ic_add
            TYPE_STOCK_UPDATE -> R.drawable.ic_update
            TYPE_ACTIVITY -> R.drawable.ic_activity
            else -> R.drawable.ic_notification
        }
    }

    /**
     * Get notification priority based on type
     */
    private fun getNotificationPriority(type: String?): Int {
        return when (type) {
            TYPE_STOCK_OUT -> NotificationCompat.PRIORITY_MAX
            TYPE_STOCK_LOW -> NotificationCompat.PRIORITY_HIGH
            TYPE_STOCK_IN, TYPE_STOCK_UPDATE -> NotificationCompat.PRIORITY_DEFAULT
            else -> NotificationCompat.PRIORITY_DEFAULT
        }
    }

    /**
     * Get notification color based on type
     */
    private fun getNotificationColor(type: String?): Int {
        return when (type) {
            TYPE_STOCK_LOW -> android.graphics.Color.parseColor("#FF9800") // Orange
            TYPE_STOCK_OUT -> android.graphics.Color.parseColor("#F44336") // Red
            TYPE_STOCK_IN -> android.graphics.Color.parseColor("#4CAF50") // Green
            TYPE_STOCK_UPDATE -> android.graphics.Color.parseColor("#2196F3") // Blue
            TYPE_ACTIVITY -> android.graphics.Color.parseColor("#9C27B0") // Purple
            else -> android.graphics.Color.parseColor("#6A1B9A") // Default purple
        }
    }

    /**
     * Generate unique notification ID
     */
    private fun generateNotificationId(data: Map<String, String>): Int {
        val type = data["type"] ?: "default"
        val itemName = data["item_name"] ?: ""
        val timestamp = System.currentTimeMillis()
        
        // Create a unique ID based on type and content
        return (type + itemName + timestamp).hashCode()
    }

    /**
     * Delete FCM token when user signs out
     */
    fun deleteTokenFromFirestore() {
        val user = auth.currentUser
        val organizationId = getOrganizationId()
        
        if (user != null && organizationId != null) {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    firestore
                        .collection("organizations")
                        .document(organizationId)
                        .collection("users")
                        .document(user.uid)
                        .update(
                            mapOf(
                                "fcmToken" to com.google.firebase.firestore.FieldValue.delete(),
                                "tokenDeletedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                            )
                        ).await()
                    
                    Log.d(TAG, "FCM token deleted from Firestore")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to delete FCM token from Firestore", e)
                }
            }
        }
    }

    /**
     * Store active stock take session info in SharedPreferences
     */
    private fun storeActiveStockTakeSession(sessionId: String?, orgId: String?) {
        if (sessionId != null && orgId != null) {
            val sharedPrefs = this.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
            sharedPrefs.edit()
                .putString("activeStockTakeSessionId", sessionId)
                .putString("activeStockTakeOrgId", orgId)
                .putLong("sessionStartTime", System.currentTimeMillis())
                .apply()
            
            // Immediately broadcast session change to app components
            val intent = Intent("com.trendstock.STOCK_TAKE_SESSION_CHANGED")
            intent.putExtra("sessionActive", true)
            intent.putExtra("sessionId", sessionId)
            intent.putExtra("orgId", orgId)
            
            // Use explicit FLAG_INCLUDE_STOPPED_PACKAGES to ensure delivery
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                sendBroadcast(intent, null)
            } else {
                intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
                sendBroadcast(intent)
            }
            
            Log.d(TAG, "📋 Stored active stock take session: $sessionId for org: $orgId and sent broadcast")
        }
    }

    /**
     * Clear active stock take session from SharedPreferences
     */
    private fun clearActiveStockTakeSession() {
        val sharedPrefs = this.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
        sharedPrefs.edit()
            .remove("activeStockTakeSessionId")
            .remove("activeStockTakeOrgId")
            .remove("sessionStartTime")
            .apply()
        
        // Immediately broadcast session change to app components
        val intent = Intent("com.trendstock.STOCK_TAKE_SESSION_CHANGED")
        intent.putExtra("sessionActive", false)
        
        // Use explicit FLAG_INCLUDE_STOPPED_PACKAGES to ensure delivery
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            sendBroadcast(intent, null)
        } else {
            intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
            sendBroadcast(intent)
        }
        
        Log.d(TAG, "🔒 Cleared active stock take session and sent broadcast")
    }

    /**
     * Check if there's an active stock take session
     */
    fun hasActiveStockTakeSession(): Boolean {
        val sharedPrefs = this.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
        return sharedPrefs.contains("activeStockTakeSessionId")
    }

    /**
     * Get active stock take session ID
     */
    fun getActiveStockTakeSessionId(): String? {
        val sharedPrefs = this.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
        return sharedPrefs.getString("activeStockTakeSessionId", null)
    }
}