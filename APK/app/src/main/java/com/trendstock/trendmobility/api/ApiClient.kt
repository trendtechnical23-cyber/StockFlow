package com.trendstock.trendmobility.api

import com.trendstock.trendmobility.BuildConfig
import com.trendstock.trendmobility.auth.AuthManager
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * ApiClient — single Retrofit instance for ALL backend calls.
 *
 * Auth: Supabase JWT attached automatically via interceptor.
 *       No Firebase Auth dependency.
 */
object ApiClient {

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BASIC
    }

    /** Attach the Supabase JWT to every request automatically. */
    private val authInterceptor = Interceptor { chain ->
        val token = AuthManager.getAccessTokenSync()
        val req = chain.request().newBuilder().apply {
            if (token != null) addHeader("Authorization", "Bearer $token")
        }.build()
        chain.proceed(req)
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .addInterceptor(loggingInterceptor)
        .build()

    private val retrofit = Retrofit.Builder()
        .baseUrl(BuildConfig.BACKEND_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()

    val apiService:    ApiService       = retrofit.create(ApiService::class.java)
    val mobileService: MobileApiService = retrofit.create(MobileApiService::class.java)

    /** Get auth header string (for callers that still pass it manually). */
    fun getAuthHeader(): String? {
        val token = AuthManager.getAccessTokenSync() ?: return null
        return "Bearer $token"
    }
}
