package com.trendstock.trendmobility.viewmodels

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.trendstock.trendmobility.database.InventoryEntity
import com.trendstock.trendmobility.database.InventoryRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class InventoryViewModel(application: Application) : AndroidViewModel(application) {
    
    private val repository = InventoryRepository.getInstance(application)
    
    private val _inventoryItems = MutableStateFlow<List<InventoryEntity>>(emptyList())
    val inventoryItems: StateFlow<List<InventoryEntity>> = _inventoryItems.asStateFlow()
    
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()
    
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    
    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()
    
    companion object {
        private const val TAG = "InventoryViewModel"
    }
    
    init {
        // Load cached inventory on init
        loadCachedInventory()
    }
    
    /**
     * Load inventory from local cache
     */
    private fun loadCachedInventory() {
        viewModelScope.launch {
            try {
                repository.getAllItemsFlow().collect { items ->
                    _inventoryItems.value = items
                    Log.d(TAG, "📦 Loaded ${items.size} items from cache")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading cached inventory", e)
                _error.value = "Failed to load inventory: ${e.message}"
            }
        }
    }
    
    /**
     * Refresh inventory from Firestore
     */
    fun refreshInventory(forceRefresh: Boolean = false) {
        viewModelScope.launch {
            try {
                _isRefreshing.value = true
                _error.value = null
                
                val result = repository.refreshInventory(forceRefresh)
                
                if (result.isFailure) {
                    _error.value = result.exceptionOrNull()?.message ?: "Unknown error"
                    Log.e(TAG, "Failed to refresh inventory", result.exceptionOrNull())
                } else {
                    Log.d(TAG, "✅ Inventory refreshed successfully")
                }
            } catch (e: Exception) {
                _error.value = "Failed to refresh: ${e.message}"
                Log.e(TAG, "Error refreshing inventory", e)
            } finally {
                _isRefreshing.value = false
            }
        }
    }
    
    /**
     * Setup real-time sync listeners
     */
    /** No-op — inventory sync is FCM-driven. Kept so callers compile. */
    fun setupRealtimeSync() { Log.d(TAG, "setupRealtimeSync: FCM-driven") }

    /** No-op — no Firestore listener to tear down. */
    fun stopRealtimeSync() { Log.d(TAG, "stopRealtimeSync: nothing to stop") }
    
    /**
     * Search inventory by name or SKU
     */
    fun searchInventory(query: String) {
        viewModelScope.launch {
            try {
                if (query.isBlank()) {
                    loadCachedInventory()
                } else {
                    repository.searchItems(query).collect { items ->
                        _inventoryItems.value = items
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error searching inventory", e)
                _error.value = "Search failed: ${e.message}"
            }
        }
    }
    
    /**
     * Get cache statistics
     */
    suspend fun getCacheStats(): String {
        return try {
            val stats = repository.getCacheStats()
            val lastFetchTime = stats.lastFetchTime?.let {
                val minutesAgo = (System.currentTimeMillis() - it) / 60000
                "${minutesAgo}m ago"
            } ?: "Never"
            
            "Items: ${stats.itemCount} | Last fetch: $lastFetchTime | Valid: ${stats.isValid}"
        } catch (e: Exception) {
            "Error: ${e.message}"
        }
    }
    
    /**
     * Clear error state
     */
    fun clearError() {
        _error.value = null
    }
    
    override fun onCleared() {
        super.onCleared()
        stopRealtimeSync()
    }
}
