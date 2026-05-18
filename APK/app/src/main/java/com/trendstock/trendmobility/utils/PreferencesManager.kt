package com.trendstock.trendmobility.utils

import android.content.Context
import android.content.SharedPreferences

class PreferencesManager private constructor(context: Context) {
    
    private val sharedPreferences: SharedPreferences = 
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    
    companion object {
        private const val PREF_NAME = "TrendMobilityPrefs"
        private const val KEY_LAST_SEARCH_QUERY = "last_search_query"
        private const val KEY_USER_PREFERENCES = "user_preferences"
        private const val KEY_LAST_SCREEN_VISITED = "last_screen_visited"
        private const val KEY_SEARCH_HISTORY = "search_history"
        
        @Volatile
        private var INSTANCE: PreferencesManager? = null
        
        fun getInstance(context: Context): PreferencesManager {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: PreferencesManager(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
    
    // Save last search query (except for StockCheck screen)
    fun saveLastSearchQuery(screen: String, query: String) {
        if (screen != "stock_check") {  // Don't save for StockCheck as per requirement
            sharedPreferences.edit()
                .putString("${KEY_LAST_SEARCH_QUERY}_$screen", query)
                .apply()
        }
    }
    
    // Get last search query
    fun getLastSearchQuery(screen: String): String {
        return if (screen == "stock_check") {
            "" // Always return empty for StockCheck
        } else {
            sharedPreferences.getString("${KEY_LAST_SEARCH_QUERY}_$screen", "") ?: ""
        }
    }
    
    // Save last visited screen
    fun saveLastScreen(screen: String) {
        sharedPreferences.edit()
            .putString(KEY_LAST_SCREEN_VISITED, screen)
            .apply()
    }
    
    // Get last visited screen
    fun getLastScreen(): String {
        return sharedPreferences.getString(KEY_LAST_SCREEN_VISITED, "main_menu") ?: "main_menu"
    }
    
    // Clear all preferences
    fun clearAll() {
        sharedPreferences.edit().clear().apply()
    }
    
    // Simple key-value storage for general app memory
    fun saveString(key: String, value: String) {
        sharedPreferences.edit().putString(key, value).apply()
    }
    
    fun getString(key: String, defaultValue: String = ""): String {
        return sharedPreferences.getString(key, defaultValue) ?: defaultValue
    }
    
    fun saveBoolean(key: String, value: Boolean) {
        sharedPreferences.edit().putBoolean(key, value).apply()
    }
    
    fun getBoolean(key: String, defaultValue: Boolean = false): Boolean {
        return sharedPreferences.getBoolean(key, defaultValue)
    }
}
