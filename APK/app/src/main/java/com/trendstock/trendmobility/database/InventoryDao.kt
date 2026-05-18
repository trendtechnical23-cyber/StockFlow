package com.trendstock.trendmobility.database

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface InventoryDao {
    
    @Query("SELECT * FROM inventory_items ORDER BY name ASC")
    fun getAllItems(): Flow<List<InventoryEntity>>
    
    @Query("SELECT * FROM inventory_items WHERE itemId = :itemId")
    suspend fun getItemById(itemId: String): InventoryEntity?
    
    @Query("SELECT * FROM inventory_items WHERE name LIKE '%' || :query || '%' OR sku LIKE '%' || :query || '%' ORDER BY name ASC")
    fun searchItems(query: String): Flow<List<InventoryEntity>>
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItem(item: InventoryEntity)
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<InventoryEntity>)
    
    @Update
    suspend fun updateItem(item: InventoryEntity)
    
    @Query("UPDATE inventory_items SET quantityAvailable = :newQuantity WHERE itemId = :itemId")
    suspend fun updateQuantity(itemId: String, newQuantity: Int)
    
    @Delete
    suspend fun deleteItem(item: InventoryEntity)
    
    @Query("DELETE FROM inventory_items")
    suspend fun deleteAllItems()
    
    @Query("SELECT COUNT(*) FROM inventory_items")
    suspend fun getItemCount(): Int
    
    @Query("SELECT lastFetchedAt FROM inventory_items ORDER BY lastFetchedAt DESC LIMIT 1")
    suspend fun getLastFetchTime(): Long?
}
