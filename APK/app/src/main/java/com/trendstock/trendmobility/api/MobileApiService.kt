package com.trendstock.trendmobility.api

import retrofit2.Response
import retrofit2.http.*

// ── Response models for mobile endpoints ──────────────────────────────────────

data class UserOrgResponse(
    val orgId:  String,
    val userId: String,
    val email:  String,
    val role:   String,
)

data class MobileInventoryItem(
    val itemId:            String,
    val name:              String,
    val sku:               String,
    val quantityAvailable: Int,
    val unit:              String?,
    val rate:              Double?,
    val minQuantity:       Int,
    val category:          String?,
    val source:            String,
)

data class MobileInventoryResponse(
    val items:      List<MobileInventoryItem>,
    val totalItems: Int,
)

data class ApprovalRequest(
    val orgId:           String,
    val itemId:          String,
    val itemName:        String?,
    val itemSKU:         String?,
    val changeType:      String,       // "stock_in" or "stock_out"
    val quantityDelta:   Int,
    val reason:          String?,
    val deviceName:      String?,
    val idempotencyKey:  String? = null,  // UUID generated per submission; prevents duplicates on retry
)

data class ApprovalResponse(
    val approvalId: String,
)

data class ActivityRequest(
    val orgId:     String,
    val type:      String,
    val itemId:    String?,
    val itemName:  String?,
    val quantity:  Int?,
    val action:    String?,
    val details:   Map<String, Any>? = null,
)

data class ActiveSession(
    val id:        String,
    val name:      String?,
    val status:    String,
    val startedAt: String?,
    val startedBy: String?,
)

data class StockTakeScanRequest(
    val orgId:             String,
    val sessionId:         String,
    val itemId:            String?,
    val sku:               String?,
    val itemName:          String?,
    val countedQuantity:   Int,
    val expectedQuantity:  Int?,
    val idempotencyKey:    String? = null,  // prevents duplicate scans on retry
)

data class DeleteFcmTokenRequest(
    val token: String,
)

// ── Retrofit interface ────────────────────────────────────────────────────────

interface MobileApiService {

    /** Resolve the org UUID for the signed-in user. */
    @GET("mobile/user-org")
    suspend fun getUserOrg(
        @Header("Authorization") auth: String,
    ): Response<ApiResponse<UserOrgResponse>>

    /** Full inventory list for the org (for Room cache population). */
    @GET("mobile/inventory")
    suspend fun getInventory(
        @Header("Authorization") auth: String,
        @Query("orgId")          orgId: String,
    ): Response<ApiResponse<MobileInventoryResponse>>

    /** Submit a stock-in / stock-out approval request. */
    @POST("mobile/approvals")
    suspend fun submitApproval(
        @Header("Authorization") auth: String,
        @Body                    body: ApprovalRequest,
    ): Response<ApiResponse<ApprovalResponse>>

    /** Log a mobile activity to the dashboard feed. */
    @POST("mobile/activity")
    suspend fun logActivity(
        @Header("Authorization") auth: String,
        @Body                    body: ActivityRequest,
    ): Response<ApiResponse<Any>>

    /** Active stock-take sessions for the org. */
    @GET("mobile/stock-take/sessions")
    suspend fun getActiveStockTakeSessions(
        @Header("Authorization") auth: String,
        @Query("orgId")          orgId: String,
    ): Response<ApiResponse<SessionsWrapper>>

    /** Record one scan entry during a stock-take session. */
    @POST("mobile/stock-take/scan")
    suspend fun recordStockTakeScan(
        @Header("Authorization") auth: String,
        @Body                    body: StockTakeScanRequest,
    ): Response<ApiResponse<Any>>

    /** Remove FCM token on logout. */
    @HTTP(method = "DELETE", path = "mobile/fcm-token", hasBody = true)
    suspend fun deleteFcmToken(
        @Header("Authorization") auth: String,
        @Body                    body: DeleteFcmTokenRequest,
    ): Response<ApiResponse<Any>>

    /** Register FCM token with the backend on login. */
    @POST("devices/register")
    suspend fun registerFcmToken(
        @Header("Authorization") auth: String,
        @Body                    body: FcmRegistrationRequest,
    ): Response<ApiResponse<Any>>
}

data class SessionsWrapper(val sessions: List<ActiveSession>)

data class FcmRegistrationRequest(
    val deviceToken: String,
    val platform:    String = "android",
    val orgId:       String,
    val deviceId:    String? = null,   // Android: Settings.Secure.ANDROID_ID
    val appVersion:  String? = null,
)
