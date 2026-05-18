package com.trendstock.trendmobility.api

import retrofit2.Response
import retrofit2.http.*

interface ApiService {
    
    @GET("zoho/items")
    suspend fun getItems(
        @Header("Authorization") authorization: String,
        @Query("search") search: String? = null
    ): Response<ApiResponse<ItemsResponse>>
    
    @POST("admin/stock/update")
    suspend fun updateStock(
        @Header("Authorization") authorization: String,
        @Body request: StockUpdateRequest
    ): Response<ApiResponse<Any>>
}
