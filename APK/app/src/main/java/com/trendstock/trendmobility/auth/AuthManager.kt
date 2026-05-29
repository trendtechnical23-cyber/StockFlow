package com.trendstock.trendmobility.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.trendstock.trendmobility.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * AuthManager — single source of truth for the Supabase session.
 *
 * Responsibilities:
 *  • Store access_token, refresh_token, user_id, org_id, email in SharedPreferences.
 *  • Provide a valid access token on demand, refreshing it transparently when it expires.
 *  • Sign out by clearing all stored values.
 *
 * The Supabase anon key (BuildConfig.SUPABASE_ANON_KEY) is embedded at build time.
 * It is safe to embed — it is NOT the service_role key and Supabase's RLS policies
 * protect all direct database access.
 */
object AuthManager {

    private const val TAG = "AuthManager"
    private const val PREFS_NAME = "SupabaseAuthPrefs"

    // Preference keys
    private const val KEY_ACCESS_TOKEN  = "sb_access_token"
    private const val KEY_REFRESH_TOKEN = "sb_refresh_token"
    private const val KEY_EXPIRES_AT    = "sb_expires_at"   // epoch millis
    private const val KEY_USER_ID       = "sb_user_id"
    private const val KEY_EMAIL         = "sb_email"
    private const val KEY_ORG_ID        = "sb_org_id"

    // 5-minute buffer — refresh before the token actually expires
    private const val REFRESH_BUFFER_MS = 5 * 60 * 1000L

    private var prefs: SharedPreferences? = null

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ── Session state ─────────────────────────────────────────────────────────

    fun isLoggedIn(): Boolean = !getAccessTokenRaw().isNullOrBlank() && !getOrgId().isNullOrBlank()

    fun getUserId():      String? = prefs?.getString(KEY_USER_ID, null)
    fun getEmail():       String? = prefs?.getString(KEY_EMAIL,   null)
    fun getOrgId():       String? = prefs?.getString(KEY_ORG_ID,  null)
    private fun getAccessTokenRaw():  String? = prefs?.getString(KEY_ACCESS_TOKEN,  null)
    private fun getRefreshToken():    String? = prefs?.getString(KEY_REFRESH_TOKEN, null)
    private fun getExpiresAt():       Long    = prefs?.getLong(KEY_EXPIRES_AT, 0L) ?: 0L

    // ── Token access (with auto-refresh) ─────────────────────────────────────

    /**
     * Returns a valid access token, refreshing it in the background if it is
     * within [REFRESH_BUFFER_MS] of expiry.  Returns null if the user is not
     * signed in or if the refresh fails.
     */
    suspend fun getAccessToken(): String? = withContext(Dispatchers.IO) {
        val token = getAccessTokenRaw() ?: return@withContext null
        val now = System.currentTimeMillis()

        if ((getExpiresAt() - now) > REFRESH_BUFFER_MS) {
            // Still fresh
            return@withContext token
        }

        // Attempt refresh
        val refreshToken = getRefreshToken() ?: return@withContext null
        return@withContext refreshSession(refreshToken)
    }

    /** Synchronous variant for contexts that cannot suspend (e.g. OkHttp interceptors). */
    fun getAccessTokenSync(): String? {
        val token = getAccessTokenRaw() ?: return null
        val now = System.currentTimeMillis()
        if ((getExpiresAt() - now) > REFRESH_BUFFER_MS) return token
        // Can't refresh synchronously without blocking — return the stale token.
        // The interceptor will receive a 401 and let the call fail cleanly.
        return token
    }

    // ── Save / clear session ──────────────────────────────────────────────────

    fun saveSession(
        accessToken:  String,
        refreshToken: String,
        expiresIn:    Int,   // seconds
        userId:       String,
        email:        String,
    ) {
        val expiresAt = System.currentTimeMillis() + (expiresIn * 1000L)
        prefs?.edit()
            ?.putString(KEY_ACCESS_TOKEN,  accessToken)
            ?.putString(KEY_REFRESH_TOKEN, refreshToken)
            ?.putLong(KEY_EXPIRES_AT,      expiresAt)
            ?.putString(KEY_USER_ID,       userId)
            ?.putString(KEY_EMAIL,         email)
            ?.apply()
        Log.d(TAG, "✅ Session saved for $email (expires in ${expiresIn}s)")
    }

    fun saveOrgId(orgId: String) {
        prefs?.edit()?.putString(KEY_ORG_ID, orgId)?.apply()
        Log.d(TAG, "✅ Org ID saved: $orgId")
    }

    fun clearSession() {
        prefs?.edit()?.clear()?.apply()
        Log.d(TAG, "🔓 Session cleared (signed out)")
    }

    // ── Supabase auth REST calls ──────────────────────────────────────────────

    /**
     * Sign in with email + password.
     * POST https://[SUPABASE_URL]/auth/v1/token?grant_type=password
     *
     * Returns Result.success(Unit) if OK; Result.failure(exception) with a
     * human-readable message on error.
     */
    suspend fun signIn(email: String, password: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply {
                put("email",    email)
                put("password", password)
            }.toString()

            val request = Request.Builder()
                .url("${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=password")
                .post(body.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey",       BuildConfig.SUPABASE_ANON_KEY)
                .addHeader("Content-Type", "application/json")
                .build()

            val response = httpClient.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                val message = runCatching { JSONObject(responseBody).optString("error_description", "Login failed") }.getOrDefault("Login failed")
                return@withContext Result.failure(Exception(message))
            }

            val json = JSONObject(responseBody)
            saveSession(
                accessToken  = json.getString("access_token"),
                refreshToken = json.getString("refresh_token"),
                expiresIn    = json.optInt("expires_in", 3600),
                userId       = json.getJSONObject("user").getString("id"),
                email        = json.getJSONObject("user").getString("email"),
            )

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "signIn error: ${e.message}")
            Result.failure(e)
        }
    }

    /**
     * Send a password-reset email via Supabase.
     * POST https://[SUPABASE_URL]/auth/v1/recover
     */
    suspend fun sendPasswordReset(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply { put("email", email) }.toString()
            val request = Request.Builder()
                .url("${BuildConfig.SUPABASE_URL}/auth/v1/recover")
                .post(body.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey",       BuildConfig.SUPABASE_ANON_KEY)
                .addHeader("Content-Type", "application/json")
                .build()
            val response = httpClient.newCall(request).execute()
            if (response.isSuccessful) Result.success(Unit)
            else {
                val msg = runCatching { JSONObject(response.body?.string() ?: "").optString("msg", "Reset failed") }.getOrDefault("Reset failed")
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            Log.e(TAG, "sendPasswordReset error: ${e.message}")
            Result.failure(e)
        }
    }

    /**
     * Refresh the session using the stored refresh token.
     * POST https://[SUPABASE_URL]/auth/v1/token?grant_type=refresh_token
     *
     * Returns the new access token, or null on failure.
     */
    suspend fun refreshSession(refreshToken: String): String? = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply { put("refresh_token", refreshToken) }.toString()

            val request = Request.Builder()
                .url("${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token")
                .post(body.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey",       BuildConfig.SUPABASE_ANON_KEY)
                .addHeader("Content-Type", "application/json")
                .build()

            val response = httpClient.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (!response.isSuccessful) {
                Log.w(TAG, "Token refresh failed (${response.code}): $responseBody")
                return@withContext null
            }

            val json = JSONObject(responseBody)
            val newAccessToken  = json.getString("access_token")
            val newRefreshToken = json.optString("refresh_token", refreshToken)
            val expiresIn       = json.optInt("expires_in", 3600)

            prefs?.edit()
                ?.putString(KEY_ACCESS_TOKEN,  newAccessToken)
                ?.putString(KEY_REFRESH_TOKEN, newRefreshToken)
                ?.putLong(KEY_EXPIRES_AT, System.currentTimeMillis() + expiresIn * 1000L)
                ?.apply()

            Log.d(TAG, "✅ Token refreshed (expires in ${expiresIn}s)")
            newAccessToken
        } catch (e: Exception) {
            Log.e(TAG, "refreshSession error: ${e.message}")
            null
        }
    }
}
