package com.trendstock.trendmobility.utils

import android.content.Context
import android.content.SharedPreferences

class UserPreferences private constructor(context: Context) {
    
    private val preferences: SharedPreferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    
    companion object {
        private const val PREF_NAME = "TrendStockPrefs"
        private const val KEY_ORGANIZATION_ID = "organization_id"
        private const val KEY_LAST_EMAIL = "last_email"
        
        @Volatile
        private var INSTANCE: UserPreferences? = null
        
        fun getInstance(context: Context): UserPreferences {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: UserPreferences(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
    
    fun saveOrganizationId(orgId: String) {
        preferences.edit()
            .putString(KEY_ORGANIZATION_ID, orgId)
            .apply()
    }
    
    fun getOrganizationId(): String? {
        return preferences.getString(KEY_ORGANIZATION_ID, null)
    }
    
    fun saveLastEmail(email: String) {
        preferences.edit()
            .putString(KEY_LAST_EMAIL, email)
            .apply()
    }
    
    fun getLastEmail(): String? {
        return preferences.getString(KEY_LAST_EMAIL, null)
    }
    
    fun clearAll() {
        preferences.edit().clear().apply()
    }
}