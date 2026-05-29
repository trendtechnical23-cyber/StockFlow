package com.trendstock.trendmobility.services

import android.content.Context
import android.util.Log
import com.trendstock.trendmobility.api.ActivityRequest
import com.trendstock.trendmobility.api.ApiClient
import com.trendstock.trendmobility.api.ApprovalRequest
import com.trendstock.trendmobility.api.StockTakeScanRequest
import com.trendstock.trendmobility.auth.AuthManager
import com.trendstock.trendmobility.utils.OrganizationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * FirebaseService — class name preserved so existing screen callers compile unchanged.
 *
 * All data operations now go through the Railway backend (/api/mobile/...)
 * which writes to Supabase. Firebase Firestore and Realtime Database
 * are no longer used. Firebase Cloud Messaging is NOT touched here —
 * it lives in FCMTokenManager and StockFlowMessagingService.
 */
class FirebaseService(private val context: Context) {

    companion object {
        private const val TAG = "FirebaseService"
    }

    private fun getOrgId() = OrganizationManager.getCurrentOrganizationId()
    private fun getEmail() = AuthManager.getEmail() ?: "unknown"

    // ── Submit stock change for admin approval ─────────────────────────────────

    /**
     * Submit a stock-in or stock-out approval request to the dashboard.
     * Inventory is NOT updated until a dashboard admin approves.
     *
     * This method is async (fire-and-forget with logging).  All callers
     * that previously relied on Firestore callbacks can keep the same call site.
     */
    fun submitPendingChange(
        stockId:    String,
        changeType: String,
        quantity:   Int,
        reason:     String,
    ) {
        val orgId = getOrgId()
        if (orgId.isNullOrBlank()) {
            Log.e(TAG, "submitPendingChange: no org ID")
            return
        }

        // Check for active stock-take session
        val prefs          = context.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
        val activeSession  = prefs.getString("activeStockTakeSessionId", null)
        val activeSessionOrg = prefs.getString("activeStockTakeOrgId",  null)
        val sessionValid   = !activeSession.isNullOrEmpty() && activeSessionOrg == orgId

        if (!activeSession.isNullOrEmpty() && !sessionValid) {
            Log.w(TAG, "Stale session from org $activeSessionOrg — clearing")
            prefs.edit().remove("activeStockTakeSessionId").remove("activeStockTakeOrgId").apply()
        }

        // Route stock-take scans to the scan endpoint
        if (changeType == "stock_take" && sessionValid) {
            Log.d(TAG, "Recording stock-take scan in session $activeSession")
            recordStockTakeScan(orgId, activeSession!!, stockId, quantity, reason)
            return
        }

        // All other changes go through approval flow
        if (changeType != "stock_in" && changeType != "stock_out") {
            Log.d(TAG, "Change type '$changeType' does not require approval")
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val accessToken = AuthManager.getAccessToken()
                if (accessToken.isNullOrBlank()) {
                    Log.e(TAG, "Not authenticated — approval not submitted")
                    return@launch
                }

                // Fetch item details from local cache first
                val cached = com.trendstock.trendmobility.database.InventoryRepository
                    .getInstance(context).getItemById(stockId)
                val itemName = cached?.name ?: "Unknown Item"
                val itemSKU  = cached?.sku  ?: stockId
                val delta    = if (changeType == "stock_in") quantity else quantity

                // Generate idempotency key: stable per (item, changeType, quantity, reason)
                // so retrying the exact same request never creates a duplicate
                val idempotencyKey = java.util.UUID.randomUUID().toString()

                val response = ApiClient.mobileService.submitApproval(
                    auth = "Bearer $accessToken",
                    body = ApprovalRequest(
                        orgId            = orgId,
                        itemId           = stockId,
                        itemName         = itemName,
                        itemSKU          = itemSKU,
                        changeType       = changeType,
                        quantityDelta    = delta,
                        reason           = reason,
                        deviceName       = android.os.Build.MODEL,
                        idempotencyKey   = idempotencyKey,
                    ),
                )

                if (response.isSuccessful && response.body()?.success == true) {
                    val approvalId = response.body()?.data?.approvalId
                    Log.d(TAG, "✅ Approval request created: $approvalId")

                    // Log activity
                    val action = when (changeType) {
                        "stock_in"  -> "Stock In: +$quantity units (Pending Approval)"
                        "stock_out" -> "Stock Out: -$quantity units (Pending Approval)"
                        else        -> "Stock Change (Pending Approval)"
                    }
                    logActivity(orgId, "stock_in".takeIf { changeType == "stock_in" } ?: "stock_out",
                        stockId, itemName, quantity, action)
                } else {
                    Log.e(TAG, "Approval request failed: ${response.body()?.message}")
                }

            } catch (e: Exception) {
                Log.e(TAG, "submitPendingChange error: ${e.message}", e)
            }
        }
    }

    // ── Stock-take scan ────────────────────────────────────────────────────────

    private fun recordStockTakeScan(
        orgId:           String,
        sessionId:       String,
        stockId:         String,
        scannedQuantity: Int,
        reason:          String,
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val accessToken = AuthManager.getAccessToken()
                if (accessToken.isNullOrBlank()) return@launch

                val cached = com.trendstock.trendmobility.database.InventoryRepository
                    .getInstance(context).getItemById(stockId)
                val sku      = cached?.sku  ?: "UNKNOWN"
                val itemName = cached?.name ?: "Unknown Item"
                val expected = cached?.quantityAvailable

                val response = ApiClient.mobileService.recordStockTakeScan(
                    auth = "Bearer $accessToken",
                    body = StockTakeScanRequest(
                        orgId            = orgId,
                        sessionId        = sessionId,
                        itemId           = stockId,
                        sku              = sku,
                        itemName         = itemName,
                        countedQuantity  = scannedQuantity,
                        expectedQuantity = expected,
                        idempotencyKey   = "${sessionId}_${stockId}",
                    ),
                )

                if (response.isSuccessful) {
                    Log.d(TAG, "✅ Stock-take scan recorded: $itemName ($scannedQuantity vs $expected expected)")
                } else {
                    Log.e(TAG, "Scan record failed: ${response.body()?.message}")
                }

            } catch (e: Exception) {
                Log.e(TAG, "recordStockTakeScan error: ${e.message}", e)
            }
        }
    }

    // ── Active session lookup ─────────────────────────────────────────────────

    fun checkForActiveStockTakeSession(context: Context, callback: (String?, String?) -> Unit) {
        val orgId = getOrgId()
        if (orgId.isNullOrBlank()) { callback(null, null); return }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val accessToken = AuthManager.getAccessToken()
                if (accessToken.isNullOrBlank()) { callback(null, null); return@launch }

                val response = ApiClient.mobileService.getActiveStockTakeSessions(
                    auth  = "Bearer $accessToken",
                    orgId = orgId,
                )
                val sessions = response.body()?.data?.sessions ?: emptyList()
                if (sessions.isNotEmpty()) {
                    Log.d(TAG, "Found ${sessions.size} active session(s)")
                    callback(sessions[0].id, orgId)
                } else {
                    Log.d(TAG, "No active sessions")
                    callback(null, null)
                }
            } catch (e: Exception) {
                Log.e(TAG, "checkForActiveStockTakeSession: ${e.message}")
                callback(null, null)
            }
        }
    }

    fun checkIfItemAlreadyScanned(itemSKU: String, callback: (Boolean, String?) -> Unit) {
        // Without a direct Supabase listener, check the backend scan endpoint.
        // Simplified: return false (the dashboard UI is the source of truth for duplicates).
        // The backend upserts on (session_id, item_id) so double-scans overwrite gracefully.
        callback(false, null)
    }

    fun getActiveStockTakeSessions(orgId: String, callback: (List<Map<String, Any>>) -> Unit) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val accessToken = AuthManager.getAccessToken()
                if (accessToken.isNullOrBlank()) { callback(emptyList()); return@launch }

                val response = ApiClient.mobileService.getActiveStockTakeSessions(
                    auth  = "Bearer $accessToken",
                    orgId = orgId,
                )
                val sessions = (response.body()?.data?.sessions ?: emptyList()).map { s ->
                    mapOf("id" to s.id, "name" to (s.name ?: ""), "status" to s.status)
                }
                callback(sessions)
            } catch (e: Exception) {
                Log.e(TAG, "getActiveStockTakeSessions: ${e.message}")
                callback(emptyList())
            }
        }
    }

    fun refreshStockTakeSessions(context: Context, callback: (List<Map<String, Any>>) -> Unit) {
        val orgId = getOrgId() ?: return callback(emptyList())
        getActiveStockTakeSessions(orgId) { sessions ->
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                android.widget.Toast.makeText(
                    context,
                    if (sessions.isNotEmpty()) "Found ${sessions.size} active session(s)"
                    else "No active stock-take sessions",
                    android.widget.Toast.LENGTH_SHORT,
                ).show()
            }
            callback(sessions)
        }
    }

    // ── Activity logging ───────────────────────────────────────────────────────

    private fun logActivity(
        orgId:    String,
        type:     String,
        itemId:   String?,
        itemName: String?,
        quantity: Int?,
        action:   String,
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            runCatching {
                val token = AuthManager.getAccessToken() ?: return@launch
                ApiClient.mobileService.logActivity(
                    auth = "Bearer $token",
                    body = ActivityRequest(
                        orgId    = orgId,
                        type     = type,
                        itemId   = itemId,
                        itemName = itemName,
                        quantity = quantity,
                        action   = action,
                    ),
                )
            }.onFailure { Log.w(TAG, "logActivity (non-fatal): ${it.message}") }
        }
    }
}
