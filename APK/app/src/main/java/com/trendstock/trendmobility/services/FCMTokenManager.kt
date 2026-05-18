package com.trendstock.trendmobility.services

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

class FCMTokenManager private constructor(private val context: Context) {
    
    companion object {
        private const val TAG = "FCMTokenManager"
        private const val PREFS_NAME = "StockFlowPrefs"
        private const val KEY_FCM_TOKEN = "fcm_token"
        private const val KEY_TOKEN_SENT_TO_SERVER = "token_sent_to_server"
        
        @Volatile
        private var INSTANCE: FCMTokenManager? = null
        
        fun getInstance(context: Context): FCMTokenManager {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: FCMTokenManager(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
    
    private val firestore = FirebaseFirestore.getInstance()
    private val auth = FirebaseAuth.getInstance()
    private val messaging = FirebaseMessaging.getInstance()
    private val sharedPrefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    
    /**
     * Initialize FCM token handling
     * Call this after user login
     */
    fun initializeFCMToken() {
        Log.d(TAG, "Initializing FCM token...")
        
        messaging.token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.w(TAG, "Fetching FCM registration token failed", task.exception)
                return@addOnCompleteListener
            }
            
            // Get new FCM registration token
            val token = task.result
            Log.d(TAG, "FCM Registration Token: $token")
            
            // Save token locally
            saveTokenLocally(token)
            
            // Send token to server
            sendTokenToFirestore(token)
        }
    }
    
    /**
     * Save token locally in SharedPreferences
     */
    private fun saveTokenLocally(token: String) {
        sharedPrefs.edit()
            .putString(KEY_FCM_TOKEN, token)
            .putBoolean(KEY_TOKEN_SENT_TO_SERVER, false)
            .apply()
        
        Log.d(TAG, "Token saved locally")
    }
    
    /**
     * Get saved token from SharedPreferences
     */
    fun getSavedToken(): String? {
        return sharedPrefs.getString(KEY_FCM_TOKEN, null)
    }
    
    /**
     * Check if token was sent to server
     */
    fun isTokenSentToServer(): Boolean {
        return sharedPrefs.getBoolean(KEY_TOKEN_SENT_TO_SERVER, false)
    }
    
    /**
     * Send token to Firestore
     */
    fun sendTokenToFirestore(token: String) {
        val user = auth.currentUser
        if (user == null) {
            Log.w(TAG, "User not authenticated, cannot send token to Firestore")
            return
        }
        
        val organizationId = getOrganizationId()
        if (organizationId == null) {
            Log.w(TAG, "No organization ID found, cannot send token to Firestore")
            return
        }
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val userDocRef = firestore
                    .collection("organizations")
                    .document(organizationId)
                    .collection("users")
                    .document(user.uid)
                
                // Create user data with FCM token
                val userData = hashMapOf(
                    "email" to user.email,
                    "fcmToken" to token,
                    "tokenUpdatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                    "lastActiveAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                    "deviceInfo" to hashMapOf(
                        "platform" to "android",
                        "appVersion" to getAppVersion(),
                        "deviceModel" to Build.MODEL,
                        "deviceManufacturer" to Build.MANUFACTURER,
                        "androidVersion" to Build.VERSION.RELEASE,
                        "sdkVersion" to Build.VERSION.SDK_INT
                    ),
                    "notificationSettings" to hashMapOf(
                        "stockLowAlerts" to true,
                        "stockOutAlerts" to true,
                        "stockInNotifications" to true,
                        "activityUpdates" to true,
                        "systemNotifications" to true
                    )
                )
                
                // Use merge: true to update existing document or create if doesn't exist
                userDocRef.set(userData, com.google.firebase.firestore.SetOptions.merge()).await()
                
                // Mark token as sent
                sharedPrefs.edit()
                    .putBoolean(KEY_TOKEN_SENT_TO_SERVER, true)
                    .apply()
                
                Log.d(TAG, "FCM token successfully sent to Firestore")
                
                // ALSO register with backend API for notifications
                registerTokenWithBackend(token, organizationId)
                
                // Subscribe to topics
                subscribeToTopics(organizationId)
                
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send FCM token to Firestore", e)
            }
        }
    }
    
    /**
     * Subscribe to FCM topics for organization-wide notifications
     */
    private suspend fun subscribeToTopics(organizationId: String) {
        try {
            // Subscribe to organization-wide topic
            messaging.subscribeToTopic("org_$organizationId").await()
            Log.d(TAG, "Subscribed to organization topic: org_$organizationId")
            
            // Subscribe to general topics
            messaging.subscribeToTopic("stockflow_general").await()
            messaging.subscribeToTopic("stockflow_alerts").await()
            
            Log.d(TAG, "Subscribed to all notification topics")
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to subscribe to FCM topics", e)
        }
    }
    
    /**
     * Unsubscribe from FCM topics (call on logout)
     */
    fun unsubscribeFromTopics() {
        val organizationId = getOrganizationId()
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (organizationId != null) {
                    messaging.unsubscribeFromTopic("org_$organizationId").await()
                }
                messaging.unsubscribeFromTopic("stockflow_general").await()
                messaging.unsubscribeFromTopic("stockflow_alerts").await()
                
                Log.d(TAG, "Unsubscribed from all notification topics")
                
            } catch (e: Exception) {
                Log.e(TAG, "Failed to unsubscribe from FCM topics", e)
            }
        }
    }
    
    /**
     * Clear token on logout
     */
    fun clearToken() {
        val user = auth.currentUser
        val organizationId = getOrganizationId()
        
        // Remove token from Firestore
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
                                "tokenDeletedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                                "lastActiveAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                            )
                        ).await()
                    
                    Log.d(TAG, "FCM token removed from Firestore")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to remove FCM token from Firestore", e)
                }
            }
        }
        
        // Clear local token
        sharedPrefs.edit()
            .remove(KEY_FCM_TOKEN)
            .putBoolean(KEY_TOKEN_SENT_TO_SERVER, false)
            .apply()
        
        // Unsubscribe from topics
        unsubscribeFromTopics()
        
        Log.d(TAG, "FCM token cleared locally")
    }
    
    /**
     * Update notification settings in Firestore
     */
    fun updateNotificationSettings(settings: Map<String, Boolean>) {
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
                                "notificationSettings" to settings,
                                "settingsUpdatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                            )
                        ).await()
                    
                    Log.d(TAG, "Notification settings updated in Firestore")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to update notification settings in Firestore", e)
                }
            }
        }
    }
    
    /**
     * Test notification functionality
     */
    fun sendTestNotification() {
        val user = auth.currentUser
        val organizationId = getOrganizationId()
        
        if (user != null && organizationId != null) {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    // Add a test notification to a notifications collection
                    val testNotification = hashMapOf(
                        "userId" to user.uid,
                        "title" to "Test Notification",
                        "body" to "This is a test notification from your StockFlow app!",
                        "type" to "system",
                        "timestamp" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
                        "read" to false
                    )
                    
                    firestore
                        .collection("organizations")
                        .document(organizationId)
                        .collection("notifications")
                        .add(testNotification).await()
                    
                    Log.d(TAG, "Test notification sent")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to send test notification", e)
                }
            }
        }
    }
    
    /**
     * Register FCM token with backend API for notifications
     */
    private fun registerTokenWithBackend(token: String, organizationId: String) {
        val user = auth.currentUser ?: return
        
        CoroutineScope(Dispatchers.IO).launch {
            try {
                Log.d(TAG, "🔄 Registering FCM token with backend API...")
                Log.d(TAG, "📱 Sending token: ${token.substring(0, 20)}...")
                
                // Get Firebase ID token for authentication
                val idToken = user.getIdToken(false).await().token
                
                // Prepare request data
                val requestData = mapOf(
                    "deviceToken" to token,
                    "platform" to "android",
                    "orgId" to organizationId
                )
                
                // Make API call to backend
                val url = "http://10.0.2.2:4000/api/devices/register" // TODO: Update to production HTTPS URL before release
                
                Log.d(TAG, "🔗 Registering FCM token at: $url")
                val json = com.google.gson.Gson().toJson(requestData)
                
                val mediaType = "application/json".toMediaType()
                val requestBody = json.toRequestBody(mediaType)
                
                val request = okhttp3.Request.Builder()
                    .url(url)
                    .post(requestBody)
                    .addHeader("Authorization", "Bearer $idToken")
                    .addHeader("Content-Type", "application/json")
                    .build()
                
                val client = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .build()
                    
                try {
                    val response = client.newCall(request).execute()
                    
                    if (response.isSuccessful) {
                        Log.d(TAG, "✅ FCM token registered with backend API")
                    } else {
                        val errorBody = response.body?.string() ?: "Unknown error"
                        Log.w(TAG, "⚠️ Failed to register: ${response.code} - $errorBody")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "⚠️ Connection failed to $url: ${e.message}")
                }
                
            } catch (e: Exception) {
                Log.w(TAG, "⚠️ Failed to register FCM token with backend API", e)
                // Don't fail the whole process if backend registration fails
            }
        }
    }
    
    /**
     * Get organization ID from UserPreferences (proper way)
     */
    private fun getOrganizationId(): String? {
        val userPrefs = com.trendstock.trendmobility.utils.UserPreferences.getInstance(context)
        val orgId = userPrefs.getOrganizationId()
        Log.d(TAG, "🏢 Retrieved organization ID: $orgId")
        return orgId
    }
    
    /**
     * Get app version
     */
    private fun getAppVersion(): String {
        return try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.versionName ?: "1.0"
        } catch (e: Exception) {
            "1.0"
        }
    }
}