package com.trendstock.trendmobility.viewmodels

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import com.trendstock.trendmobility.api.InventoryItem
import com.trendstock.trendmobility.repository.StockRepository
import com.trendstock.trendmobility.services.RealTimeNotificationService

class StockViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = StockRepository(application)
    
    private val _isLoading = MutableLiveData<Boolean>()
    val isLoading: LiveData<Boolean> = _isLoading
    
    private val _errorMessage = MutableLiveData<String?>()
    val errorMessage: LiveData<String?> = _errorMessage
    
    // Get stocks from repository (SQLite cache with real-time sync)
    val stocks: LiveData<List<InventoryItem>> = repository.stocks
    
    fun submitStockIn(stockId: String, quantity: Int, reason: String) {
        repository.submitStockChange(stockId, "stock_in", quantity, reason)
        // Notification will be automatically triggered by RealTimeNotificationService
    }
    
    fun submitStockOut(stockId: String, quantity: Int, reason: String) {
        repository.submitStockChange(stockId, "stock_out", quantity, reason)
        // Notification will be automatically triggered by RealTimeNotificationService
    }
    
    fun submitStockTake(stockId: String, quantity: Int, reason: String) {
        repository.submitStockChange(stockId, "stock_take", quantity, reason)
        // Notification will be automatically triggered by RealTimeNotificationService
    }
    
    fun searchStocks(query: String): List<InventoryItem> {
        return repository.searchStocks(query)
    }

    fun refreshStocks() {
        repository.refreshStocks()
    }

    fun clearError() {
        _errorMessage.value = null
    }
}
