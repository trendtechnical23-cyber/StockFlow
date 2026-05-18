package com.trendstock.trendmobility.database

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.trendstock.trendmobility.api.InventoryItem

@Entity(tableName = "inventory_items")
data class InventoryEntity(
    @PrimaryKey
    val itemId: String,
    val name: String,
    val sku: String,
    val quantityAvailable: Int,
    val unit: String?,
    val rate: Double?,
    val lastFetchedAt: Long = System.currentTimeMillis() // Track when this was cached
)

// Conversion functions
fun InventoryEntity.toInventoryItem(): InventoryItem {
    return InventoryItem(
        itemId = itemId,
        name = name,
        sku = sku,
        quantityAvailable = quantityAvailable,
        unit = unit,
        rate = rate
    )
}

fun InventoryItem.toEntity(): InventoryEntity {
    return InventoryEntity(
        itemId = itemId,
        name = name,
        sku = sku,
        quantityAvailable = quantityAvailable,
        unit = unit,
        rate = rate
    )
}
