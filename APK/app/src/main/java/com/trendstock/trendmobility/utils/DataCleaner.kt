package com.trendstock.trendmobility.utils

import android.content.Context
import android.util.Log
import com.trendstock.trendmobility.database.AppDatabase
import com.trendstock.trendmobility.database.InventoryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object DataCleaner {
    private const val TAG = "DataCleaner"
    
    /**
     * COMPREHENSIVE DATA CLEANUP FOR BETA TESTING
     * Clears ALL local data to ensure a fresh start
     */
    suspend fun clearAllLocalData(context: Context): Result<String> {
        return withContext(Dispatchers.IO) {
            try {
                Log.d(TAG, "🧹 Starting comprehensive data cleanup...")
                val results = mutableListOf<String>()
                
                // 1. Clear SQLite Database (Inventory Cache)
                try {
                    val inventoryRepo = InventoryRepository.getInstance(context)
                    inventoryRepo.clearCache()
                    results.add("✅ SQLite cache cleared")
                    Log.d(TAG, "✅ SQLite inventory cache cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear SQLite cache", e)
                    results.add("⚠️ SQLite cache: ${e.message}")
                }
                
                // 2. Clear Room Database completely
                try {
                    AppDatabase.getInstance(context).clearAllTables()
                    results.add("✅ Room database cleared")
                    Log.d(TAG, "✅ Room database tables cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear Room database", e)
                    results.add("⚠️ Room database: ${e.message}")
                }
                
                // 3. Clear SharedPreferences - UserPreferences
                try {
                    val userPrefs = context.getSharedPreferences("UserPreferences", Context.MODE_PRIVATE)
                    userPrefs.edit().clear().apply()
                    results.add("✅ UserPreferences cleared")
                    Log.d(TAG, "✅ UserPreferences cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear UserPreferences", e)
                }
                
                // 4. Clear SharedPreferences - StockFlowPrefs
                try {
                    val stockFlowPrefs = context.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
                    stockFlowPrefs.edit().clear().apply()
                    results.add("✅ StockFlowPrefs cleared")
                    Log.d(TAG, "✅ StockFlowPrefs cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear StockFlowPrefs", e)
                }
                
                // 5. Clear SharedPreferences - Settings
                try {
                    val settingsPrefs = context.getSharedPreferences("Settings", Context.MODE_PRIVATE)
                    settingsPrefs.edit().clear().apply()
                    results.add("✅ Settings preferences cleared")
                    Log.d(TAG, "✅ Settings preferences cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear Settings", e)
                }
                
                // 6. Clear FCM Token Cache
                try {
                    val fcmPrefs = context.getSharedPreferences("FCM_TOKEN", Context.MODE_PRIVATE)
                    fcmPrefs.edit().clear().apply()
                    results.add("✅ FCM token cache cleared")
                    Log.d(TAG, "✅ FCM token cache cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear FCM cache", e)
                }
                
                // 7. Clear OrganizationManager cached data
                try {
                    OrganizationManager.getInstance().getContext()?.let { ctx ->
                        UserPreferences.getInstance(ctx).clearAll()
                    }
                    results.add("✅ Organization cache cleared")
                    Log.d(TAG, "✅ Organization cache cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear organization cache", e)
                }
                
                // 8. Clear PreferencesManager data
                try {
                    PreferencesManager.getInstance(context).clearAll()
                    results.add("✅ PreferencesManager cleared")
                    Log.d(TAG, "✅ PreferencesManager cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear PreferencesManager", e)
                }
                
                // 9. Close and reset database connections
                try {
                    AppDatabase.closeDatabase()
                    results.add("✅ Database connections closed")
                    Log.d(TAG, "✅ Database connections closed")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to close database", e)
                }
                
                Log.d(TAG, "✅ CLEANUP COMPLETE - All local data cleared")
                
                val summary = results.joinToString("\\n")
                Result.success("🧹 Cleanup Complete:\\n\\n$summary\\n\\n⚠️ Please logout and restart the app for a fresh start.")
                
            } catch (e: Exception) {
                Log.e(TAG, "❌ CLEANUP FAILED", e)
                Result.failure(e)
            }
        }
    }
    
    /**
     * FIX APK-ISSUE-#1, #2, #4: Clear data for specific organization
     * Called when switching between organizations to prevent data leakage
     */
    suspend fun clearOrganizationSpecificData(context: Context, organizationId: String?): Result<String> {
        return withContext(Dispatchers.IO) {
            try {
                Log.d(TAG, "🧹 Clearing data for organization: $organizationId")
                val results = mutableListOf<String>()
                
                // 1. Clear stock take sessions for this organization
                try {
                    val stockFlowPrefs = context.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
                    val storedOrgId = stockFlowPrefs.getString("activeStockTakeOrgId", null)
                    
                    if (storedOrgId == organizationId || organizationId == null) {
                        stockFlowPrefs.edit()
                            .remove("activeStockTakeSessionId")
                            .remove("activeStockTakeOrgId")
                            .apply()
                        results.add("✅ Stock take session cleared for org: $organizationId")
                        Log.d(TAG, "✅ Stock take session cleared")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear stock take sessions", e)
                    results.add("⚠️ Stock take clear: ${e.message}")
                }
                
                // 2. Clear cached inventory
                try {
                    val inventoryRepo = InventoryRepository.getInstance(context)
                    inventoryRepo.clearCache()
                    results.add("✅ Inventory cache cleared")
                    Log.d(TAG, "✅ Inventory cache cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear inventory cache", e)
                    results.add("⚠️ Inventory cache: ${e.message}")
                }
                
                // 3. Clear UI preferences (search history, etc.)
                try {
                    PreferencesManager.getInstance(context).clearAll()
                    results.add("✅ UI preferences cleared")
                    Log.d(TAG, "✅ UI preferences cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear UI preferences", e)
                }
                
                // 4. Notify notification service to clear its state
                try {
                    com.trendstock.trendmobility.services.RealTimeNotificationService
                        .getInstance(context).clearState()
                    results.add("✅ Notification state cleared")
                    Log.d(TAG, "✅ Notification state cleared")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear notification state", e)
                }
                
                Log.d(TAG, "🧹 Organization data cleanup complete")
                Result.success(results.joinToString("\\n"))
            } catch (e: Exception) {
                Log.e(TAG, "❌ Organization cleanup failed", e)
                Result.failure(e)
            }
        }
    }
    
    /**
     * Clear only cache data (keep user preferences)
     */
    suspend fun clearCacheOnly(context: Context): Result<String> {
        return withContext(Dispatchers.IO) {
            try {
                Log.d(TAG, "🗑️ Clearing cache data only...")
                
                // Clear SQLite cache
                val inventoryRepo = InventoryRepository.getInstance(context)
                inventoryRepo.clearCache()
                
                // Clear Room database
                AppDatabase.getInstance(context).clearAllTables()
                
                Log.d(TAG, "✅ Cache cleared successfully")
                Result.success("✅ Cache cleared successfully")
                
            } catch (e: Exception) {
                Log.e(TAG, "❌ Failed to clear cache", e)
                Result.failure(e)
            }
        }
    }
}
