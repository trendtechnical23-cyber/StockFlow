package com.trendstock.trendmobility.repository

import android.content.Context
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.LiveData
import androidx.lifecycle.asLiveData
import com.trendstock.trendmobility.api.*
import com.trendstock.trendmobility.services.FirebaseService
import com.trendstock.trendmobility.database.InventoryRepository
import com.trendstock.trendmobility.database.toInventoryItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class StockRepository(
    private val context: Context
) {
    private val firebaseService = FirebaseService(context)
    private val inventoryRepository = InventoryRepository.getInstance(context)

    // Use cached inventory from SQLite instead of real-time Firestore
    val stocks: LiveData<List<InventoryItem>> = inventoryRepository.getAllItemsFlow()
        .map { entities -> entities.map { it.toInventoryItem() } }
        .asLiveData()

    init {
        // Ensure realtime sync is running and cache is seeded even if HomeScreen
        // has not been visited yet (e.g. cold start directly into a stock screen).
        CoroutineScope(Dispatchers.IO).launch {
            inventoryRepository.setupRealtimeSync()
            if (!inventoryRepository.isCacheValid()) {
                inventoryRepository.refreshInventory(forceRefresh = false)
            }
        }
    }

    // Force a fresh fetch from Firestore (called by pull-to-refresh / retry)
    fun refreshStocks() {
        CoroutineScope(Dispatchers.IO).launch {
            inventoryRepository.refreshInventory(forceRefresh = true)
        }
    }

    // Submit stock change for admin approval
    fun submitStockChange(stockId: String, changeType: String, quantity: Int, reason: String) {
        firebaseService.submitPendingChange(stockId, changeType, quantity, reason)
    }

    // Search stocks locally from cache
    fun searchStocks(query: String): List<InventoryItem> {
        val allStocks = stocks.value ?: emptyList()
        return allStocks.filter {
            it.name.contains(query, ignoreCase = true) ||
            it.sku.contains(query, ignoreCase = true)
        }
    }
}
