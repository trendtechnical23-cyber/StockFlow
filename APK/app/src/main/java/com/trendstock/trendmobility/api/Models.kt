package com.trendstock.trendmobility.api

import com.google.gson.annotations.SerializedName

data class ApiResponse<T>(
    val success: Boolean,
    val message: String?,
    val data: T?
)

data class InventoryItem(
    @SerializedName("item_id")
    val itemId: String = "",
    val name: String = "",
    val sku: String = "",
    @SerializedName("quantity_available")
    val quantityAvailable: Int = 0,
    val unit: String? = null,
    val rate: Double? = null
)

data class ItemsResponse(
    @SerializedName("total_items")
    val totalItems: Int,
    val items: List<InventoryItem>
)

data class StockUpdateRequest(
    @SerializedName("item_id")
    val itemId: String,
    @SerializedName("new_quantity")
    val newQuantity: Int,
    val reason: String,
    @SerializedName("adjustment_type")
    val adjustmentType: String
)
