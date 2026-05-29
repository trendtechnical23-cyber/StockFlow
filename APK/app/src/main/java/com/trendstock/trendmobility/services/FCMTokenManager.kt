package com.trendstock.trendmobility.services

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.trendstock.trendmobility.api.ApiClient
import com.trendstock.trendmobility.api.DeleteFcmTokenRequest
import com.trendstock.trendmobility.api.FcmRegistrationRequest
import com.trendstock.trendmobility.auth.AuthManager
import com.trendstock.trendmobility.utils.UserPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * FCMTokenManager — manages Firebase Cloud Messaging tokens.
 *
 * Firebase Messaging (FCM) is KEPT for push notifications.
 * Token storage has been moved from Firestore → Railway backend
 * (/api/devices/register), which stores it in Supabase fcm_tokens.
 */
class FCMTokenManager private constructor(private val context: Context) {

    companion object {
        private const val TAG             = "FCMTokenManager"
        private const val PREFS_NAME      = "StockFlowPrefs"
        private const val KEY_FCM_TOKEN   = "fcm_token"
        private const val KEY_TOKEN_SENT  = "token_sent_to_server"

        @Volatile private var INSTANCE: FCMTokenManager? = null

        fun getInstance(context: Context): FCMTokenManager =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: FCMTokenManager(context.applicationContext).also { INSTANCE = it }
            }
    }

    private val messaging: FirebaseMessaging       = FirebaseMessaging.getInstance()
    private val prefs:     SharedPreferences       = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ── Public API ─────────────────────────────────────────────────────────────

    /** Call after successful login to register the FCM token. */
    fun initializeFCMToken() {
        Log.d(TAG, "Initialising FCM token…")
        messaging.token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.w(TAG, "FCM token fetch failed", task.exception)
                return@addOnCompleteListener
            }
            val token = task.result
            prefs.edit().putString(KEY_FCM_TOKEN, token).putBoolean(KEY_TOKEN_SENT, false).apply()
            sendTokenToBackend(token)
        }
    }

    fun getSavedToken(): String? = prefs.getString(KEY_FCM_TOKEN, null)

    /**
     * Call on logout — deletes the token from the backend so push
     * notifications stop going to this device.
     */
    fun clearToken() {
        val token = getSavedToken()
        if (!token.isNullOrBlank()) {
            CoroutineScope(Dispatchers.IO).launch {
                runCatching {
                    val auth = AuthManager.getAccessToken()?.let { "Bearer $it" } ?: return@runCatching
                    ApiClient.mobileService.deleteFcmToken(auth, DeleteFcmTokenRequest(token))
                    Log.d(TAG, "FCM token removed from backend")
                }.onFailure { Log.w(TAG, "Could not remove FCM token from backend: ${it.message}") }
            }
        }

        // Unsubscribe from topics
        val orgId = UserPreferences.getInstance(context).getOrganizationId()
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                if (orgId != null) messaging.unsubscribeFromTopic("org_$orgId").await()
                messaging.unsubscribeFromTopic("stockflow_general").await()
                messaging.unsubscribeFromTopic("stockflow_alerts").await()
            }
        }

        prefs.edit().remove(KEY_FCM_TOKEN).putBoolean(KEY_TOKEN_SENT, false).apply()
        Log.d(TAG, "FCM token cleared locally")
    }

    // ── Token registration with Railway backend ────────────────────────────────

    private fun sendTokenToBackend(token: String) {
        val orgId = UserPreferences.getInstance(context).getOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.w(TAG, "No org ID — skipping FCM registration")
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val accessToken = AuthManager.getAccessToken()
                if (accessToken.isNullOrBlank()) {
                    Log.w(TAG, "No access token — skipping FCM registration")
                    return@launch
                }

                // Stable Android device identifier — survives app reinstall,
                // changes only on factory reset (which is the intended behavior)
                val androidId = Settings.Secure.getString(
                    context.contentResolver,
                    Settings.Secure.ANDROID_ID
                )

                val appVersion = runCatching {
                    context.packageManager.getPackageInfo(context.packageName, 0).versionName
                }.getOrNull()

                val response = ApiClient.mobileService.registerFcmToken(
                    auth = "Bearer $accessToken",
                    body = FcmRegistrationRequest(
                        deviceToken = token,
                        platform    = "android",
                        orgId       = orgId,
                        deviceId    = androidId,
                        appVersion  = appVersion,
                    ),
                )

                if (response.isSuccessful) {
                    prefs.edit().putBoolean(KEY_TOKEN_SENT, true).apply()
                    Log.d(TAG, "✅ FCM token registered with backend")
                } else {
                    Log.w(TAG, "Backend FCM registration returned ${response.code()}")
                }

                // Subscribe to topics
                messaging.subscribeToTopic("org_$orgId").await()
                messaging.subscribeToTopic("stockflow_general").await()
                messaging.subscribeToTopic("stockflow_alerts").await()
                Log.d(TAG, "Subscribed to FCM topics")

            } catch (e: Exception) {
                Log.w(TAG, "FCM backend registration error (non-fatal): ${e.message}")
            }
        }
    }
}
