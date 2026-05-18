package com.trendstock.trendmobility.utils

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

object OrganizationManager {
    
    private const val TAG = "OrganizationManager"
    private var context: Context? = null
    private var currentOrgId: String? = null
    private val switchListeners = mutableListOf<OrganizationSwitchListener>()
    
    interface OrganizationSwitchListener {
        fun onOrganizationSwitching(oldOrgId: String?, newOrgId: String)
        fun onOrganizationSwitched(newOrgId: String)
    }
    
    fun initialize(appContext: Context) {
        context = appContext
        currentOrgId = context?.let { ctx ->
            UserPreferences.getInstance(ctx).getOrganizationId()
        }
    }
    
    fun getInstance(): OrganizationManager = this
    
    fun getContext(): Context? = context
    
    fun getCurrentOrganizationId(): String? {
        return currentOrgId ?: context?.let { ctx ->
            UserPreferences.getInstance(ctx).getOrganizationId().also {
                currentOrgId = it
            }
        }
    }
    
    fun hasValidOrganization(): Boolean {
        return !getCurrentOrganizationId().isNullOrBlank()
    }
    
    fun registerSwitchListener(listener: OrganizationSwitchListener) {
        if (!switchListeners.contains(listener)) {
            switchListeners.add(listener)
        }
    }
    
    fun unregisterSwitchListener(listener: OrganizationSwitchListener) {
        switchListeners.remove(listener)
    }
    
    /**
     * FIX APK-ISSUE-#3: Centralized organization switch handler
     * Properly cleans up old organization data before switching
     */
    fun switchOrganization(newOrgId: String) {
        val ctx = context ?: return
        val oldOrgId = currentOrgId
        
        // Skip if same organization
        if (oldOrgId == newOrgId) {
            Log.d(TAG, "Organization unchanged: $newOrgId")
            return
        }
        
        Log.d(TAG, "🔄 Switching organization: $oldOrgId → $newOrgId")
        
        // 1. Notify all listeners to prepare for switch
        switchListeners.forEach { listener ->
            try {
                listener.onOrganizationSwitching(oldOrgId, newOrgId)
            } catch (e: Exception) {
                Log.e(TAG, "Error in listener onOrganizationSwitching", e)
            }
        }
        
        // 2. Stop all Firebase listeners for old organization
        try {
            com.trendstock.trendmobility.services.RealTimeNotificationService
                .getInstance(ctx).stopListening()
            Log.d(TAG, "✅ Stopped notification listeners")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to stop notification listeners", e)
        }
        
        // 3. Clear organization-specific data
        clearOrganizationData(ctx, oldOrgId)
        
        // 4. Update organization ID
        UserPreferences.getInstance(ctx).saveOrganizationId(newOrgId)
        currentOrgId = newOrgId
        Log.d(TAG, "✅ Organization ID updated: $newOrgId")
        
        // 5. Notify all listeners of completion
        switchListeners.forEach { listener ->
            try {
                listener.onOrganizationSwitched(newOrgId)
            } catch (e: Exception) {
                Log.e(TAG, "Error in listener onOrganizationSwitched", e)
            }
        }
        
        // 6. Restart listeners for new organization
        try {
            com.trendstock.trendmobility.services.RealTimeNotificationService
                .getInstance(ctx).startListening()
            Log.d(TAG, "✅ Restarted notification listeners for new org")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to restart notification listeners", e)
        }
        
        Log.d(TAG, "✅ Organization switch complete")
    }
    
    /**
     * FIX APK-ISSUE-#1: Clear stock take sessions on organization switch
     * FIX APK-ISSUE-#4: Clear cached inventory on organization switch
     */
    private fun clearOrganizationData(ctx: Context, oldOrgId: String?) {
        Log.d(TAG, "🧹 Clearing data for organization: $oldOrgId")
        
        try {
            // Clear stock take sessions (FIX ISSUE #1)
            val stockFlowPrefs = ctx.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
            stockFlowPrefs.edit()
                .remove("activeStockTakeSessionId")
                .remove("activeStockTakeOrgId")
                .apply()
            Log.d(TAG, "✅ Cleared stock take sessions")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to clear stock take sessions", e)
        }
        
        try {
            // Clear cached inventory (FIX ISSUE #4) - Launch in coroutine
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    com.trendstock.trendmobility.database.InventoryRepository
                        .getInstance(ctx).clearCache()
                    Log.d(TAG, "✅ Cleared inventory cache")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Failed to clear inventory cache", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to launch cache clear coroutine", e)
        }
        
        try {
            // Clear search history and UI state
            PreferencesManager.getInstance(ctx).clearAll()
            Log.d(TAG, "✅ Cleared preferences")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to clear preferences", e)
        }
    }
}