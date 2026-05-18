package com.trendstock.trendmobility.services

import android.content.Context
import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.trendstock.trendmobility.api.InventoryItem

class FirebaseService(private val context: Context) {
    private val firestore = FirebaseFirestore.getInstance()
    private val auth = FirebaseAuth.getInstance()
    
    companion object {
        private const val TAG = "FirebaseService"
        
        // Sanitize SKU for use in Firebase Realtime Database paths
        // Firebase paths cannot contain: . # $ [ ]
        private fun sanitizeSKU(sku: String): String {
            return sku.replace(".", "_")
                .replace("#", "_")
                .replace("$", "_")
                .replace("[", "_")
                .replace("]", "_")
        }
    }
    
    private fun getCurrentOrganizationId(): String? {
        return com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId()
    }
    
    // Listen to stock updates from dashboard using Firestore
    fun listenToStocks(onStocksUpdated: (List<InventoryItem>) -> Unit): ListenerRegistration? {
        val currentUser = auth.currentUser
        if (currentUser == null) {
            Log.e(TAG, "No authenticated user")
            return null
        }

        val orgId = getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.e(TAG, "No organization ID found")
            return null
        }

        Log.d(TAG, "Listening to stocks for organization: $orgId")

        // Use organization-scoped collection like the web dashboard
        return firestore.collection("organizations")
            .document(orgId)
            .collection("inventory")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Failed to read stocks from Firestore", error)
                    return@addSnapshotListener
                }
                
                val stocks = mutableListOf<InventoryItem>()
                snapshot?.documents?.forEach { document ->
                    try {
                        val data = document.data
                        if (data != null) {
                            val item = InventoryItem(
                                itemId = document.id,
                                name = data["name"]?.toString() ?: "",
                                sku = data["sku"]?.toString() ?: "",
                                quantityAvailable = (data["stock"] as? Number)?.toInt() ?: 0,
                                unit = data["unit"]?.toString(),
                                rate = (data["price"] as? Number)?.toDouble()
                            )
                            stocks.add(item)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error parsing stock item: ${document.id}", e)
                    }
                }
                onStocksUpdated(stocks)
                Log.d(TAG, "Received ${stocks.size} stocks from Firestore")
            }
    }
    
    // Submit pending change for admin approval - NO immediate stock update
    fun submitPendingChange(stockId: String, changeType: String, quantity: Int, reason: String) {
        val userId = auth.currentUser?.uid ?: return
        val userEmail = auth.currentUser?.email ?: ""
        val userDisplayName = auth.currentUser?.displayName ?: userEmail.split("@").firstOrNull() ?: "Mobile User"
        
        Log.d(TAG, "🚀 STARTING STOCK UPDATE: $stockId ($changeType: $quantity)")
        
        // Check for active stock take session
        val sharedPrefs = context.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
        val activeSessionId = sharedPrefs.getString("activeStockTakeSessionId", null)
        val activeOrgId = sharedPrefs.getString("activeStockTakeOrgId", null)
        
        // FIX APK-ISSUE-#1: Validate stock take session belongs to current organization
        val currentOrgId = getCurrentOrganizationId()
        val isSessionValid = !activeSessionId.isNullOrEmpty() && 
                            activeOrgId == currentOrgId
        
        if (!activeSessionId.isNullOrEmpty() && !isSessionValid) {
            Log.w(TAG, "⚠️ Stock take session from different org detected: $activeOrgId (current: $currentOrgId)")
            Log.w(TAG, "⚠️ Clearing stale session data")
            sharedPrefs.edit()
                .remove("activeStockTakeSessionId")
                .remove("activeStockTakeOrgId")
                .apply()
        }
        
        // Determine the change type and handle session recording
        val finalChangeType = if (isSessionValid && changeType == "stock_take") {
            Log.d(TAG, "📋 Stock take session active: $activeSessionId - Recording scan")
            recordStockTakeScan(currentOrgId!!, activeSessionId, stockId, quantity, reason)
            "stock_take_scan" // Special type for session scans
        } else {
            changeType
        }
        
        val orgId = getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.e(TAG, "No organization ID found for pending change")
            return
        }

        // Check if Zoho is connected
        firestore.collection("organizations")
            .document(orgId)
            .get()
            .addOnSuccessListener { orgDoc ->
                val integrations = orgDoc.get("integrations") as? Map<*, *>
                val zohoIntegration = integrations?.get("zoho") as? Map<*, *>
                val zohoStatus = zohoIntegration?.get("status") as? String
                val isZohoConnected = zohoStatus == "connected"
                
                Log.d(TAG, "🔗 Zoho connection status: $zohoStatus (for reference only)")
                Log.d(TAG, "📋 ALWAYS creating approval request for Stock In/Out - admin approval REQUIRED")
                
                // ALWAYS create approval request for stock changes - regardless of Zoho status
                if (changeType == "stock_in" || changeType == "stock_out") {
                    Log.d(TAG, "📋 Creating approval request for $changeType operation")
                    
                    // Get item details first
                    firestore.collection("organizations")
                        .document(orgId)
                        .collection("inventory")
                        .document(stockId)
                        .get()
                        .addOnSuccessListener { itemDoc ->
                            val itemName = itemDoc.getString("name") ?: "Unknown Item"
                            val itemSKU = itemDoc.getString("sku") ?: stockId
                            val currentStock = (itemDoc.getLong("stock"))?.toInt() ?: 0
                            
                            val quantityDelta = when (changeType) {
                                "stock_in" -> quantity
                                "stock_out" -> -quantity
                                else -> 0
                            }
                            
                            val newQuantity = when (changeType) {
                                "stock_in" -> currentStock + quantity
                                "stock_out" -> (currentStock - quantity).coerceAtLeast(0)
                                else -> currentStock
                            }
                            
                            // Create approval request
                            val approvalRequest = hashMapOf(
                                "type" to "zoho_sync",
                                "action" to "adjust_stock",
                                "itemId" to stockId,
                                "itemName" to itemName,
                                "itemSKU" to itemSKU,
                                "requestedBy" to userId,
                                "requestedByName" to userDisplayName,
                                "requestedChange" to hashMapOf(
                                    "quantityDelta" to quantityDelta,
                                    "newQuantity" to newQuantity,
                                    "reason" to reason
                                ),
                                "status" to "pending",
                                "requestedAt" to com.google.firebase.Timestamp.now(),
                                "processed" to false,
                                "source" to "apk"
                            )
                            
                            firestore.collection("organizations")
                                .document(orgId)
                                .collection("approvals")
                                .add(approvalRequest)
                                .addOnSuccessListener { docRef ->
                                    Log.d(TAG, "✅ Approval request created: ${docRef.id}")
                                    Log.d(TAG, "⏳ Stock change pending approval - NO inventory update until approved")
                                    
                                    // Create dashboard notification
                                    createDashboardNotification(
                                        orgId, 
                                        itemName, 
                                        changeType, 
                                        quantity, 
                                        userDisplayName, 
                                        docRef.id
                                    )
                                    
                                    // Log approval request activity
                                    val actionDescription = when (changeType) {
                                        "stock_in" -> "Stock In: +$quantity units (Pending Approval)"
                                        "stock_out" -> "Stock Out: -$quantity units (Pending Approval)"
                                        else -> "Stock Change: $reason (Pending Approval)"
                                    }
                                    
                                    try {
                                        val context = com.trendstock.trendmobility.utils.OrganizationManager.getInstance().getContext()
                                        if (context != null) {
                                            val realtimeService = com.stockflow.inventory.RealtimeActivityService.getInstance(
                                                context, 
                                                firestore
                                            )
                                            realtimeService.addActivity(
                                                orgId = orgId,
                                                userId = userEmail,
                                                action = actionDescription,
                                                itemId = stockId,
                                                itemName = itemName,
                                                quantity = currentStock
                                            )
                                            Log.d(TAG, "📋 Approval request activity logged")
                                        }
                                    } catch (e: Exception) {
                                        Log.e(TAG, "❌ Failed to log approval activity", e)
                                    }
                                }
                                .addOnFailureListener { e ->
                                    Log.e(TAG, "❌ Failed to create approval request", e)
                                }
                        }
                        .addOnFailureListener { e ->
                            Log.e(TAG, "❌ Failed to get item details for approval", e)
                        }
                } else {
                    Log.d(TAG, "ℹ️ Stock take operation - no approval needed")
                }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Failed to check organization status", e)
            }
    }
    
    /**
     * Create dashboard notification for pending stock change
     */
    private fun createDashboardNotification(
        orgId: String,
        itemName: String,
        changeType: String,
        quantity: Int,
        userName: String,
        approvalId: String
    ) {
        val actionText = when (changeType) {
            "stock_in" -> "📲 Mobile: Stock In Request (+$quantity)"
            "stock_out" -> "📲 Mobile: Stock Out Request (-$quantity)"
            else -> "📲 Mobile: Stock Change Request"
        }
        
        val notificationData = hashMapOf(
            "type" to "approval_pending",
            "title" to "📱 Mobile Stock Change Request",
            "message" to "$userName requested $actionText for $itemName",
            "targetUserId" to "ALL",
            "priority" to "high",
            "createdAt" to com.google.firebase.Timestamp.now(),
            "readBy" to listOf<String>(),
            "metadata" to hashMapOf(
                "approvalId" to approvalId,
                "itemName" to itemName,
                "changeType" to changeType,
                "quantity" to quantity,
                "source" to "mobile_app",
                "userName" to userName
            )
        )
        
        firestore.collection("organizations")
            .document(orgId)
            .collection("notifications")
            .add(notificationData)
            .addOnSuccessListener {
                Log.d(TAG, "✅ Dashboard notification created")
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Failed to create dashboard notification", e)
            }
    }
    
    // DEPRECATED - Stock should NEVER be updated immediately from mobile
    // All changes must go through dashboard approval workflow
    @Deprecated("Stock updates must be approved by dashboard admin")
    private fun updateStockQuantity(stockId: String, changeType: String, quantity: Int) {
        val orgId = getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.e(TAG, "No organization ID found for stock update")
            return
        }

        val stockRef = firestore.collection("organizations")
            .document(orgId)
            .collection("inventory")
            .document(stockId)
        
        stockRef.get().addOnSuccessListener { document ->
            if (document.exists()) {
                val currentQuantity = (document.getLong("stock"))?.toInt() ?: 0
                val newQuantity = when (changeType) {
                    "stock_in" -> currentQuantity + quantity
                    "stock_out" -> (currentQuantity - quantity).coerceAtLeast(0) // Don't go below 0
                    "stock_take" -> quantity // Stock take sets absolute quantity
                    else -> currentQuantity
                }
                
                // Update stock field to match web dashboard schema
                val updates = mapOf(
                    "stock" to newQuantity,
                    "lastModified" to System.currentTimeMillis().toString(),
                    "source" to "mobile"
                )
                
                stockRef.update(updates)
                    .addOnSuccessListener {
                        Log.d(TAG, "✅ FIRESTORE STOCK UPDATED IMMEDIATELY: $stockId -> $newQuantity ($changeType: $quantity)")
                        
                        // Log real-time activity for dashboard mirroring
                        logStockActivity(orgId, stockId, document.getString("name") ?: "Unknown Item", changeType, quantity, newQuantity)
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "❌ FAILED TO UPDATE FIRESTORE STOCK", e)
                    }
            } else {
                Log.e(TAG, "❌ STOCK NOT FOUND: $stockId")
            }
        }.addOnFailureListener { e ->
            Log.e(TAG, "❌ FAILED TO READ CURRENT STOCK QUANTITY", e)
        }
    }
    
    /**
     * Log stock activity for real-time mirroring to dashboard
     */
    private fun logStockActivity(
        orgId: String, 
        itemId: String, 
        itemName: String, 
        changeType: String, 
        quantity: Int, 
        newQuantity: Int
    ) {
        val currentUser = FirebaseAuth.getInstance().currentUser
        if (currentUser == null) {
            Log.w(TAG, "⚠️ No current user for activity logging")
            return
        }

        try {
            // Get RealtimeActivityService instance
            val context = com.trendstock.trendmobility.utils.OrganizationManager.getInstance().getContext()
            if (context != null) {
                val realtimeService = com.stockflow.inventory.RealtimeActivityService.getInstance(
                    context, 
                    com.google.firebase.firestore.FirebaseFirestore.getInstance()
                )

                // Create activity description
                val action = when (changeType) {
                    "stock_in" -> "Stock In: Added $quantity units"
                    "stock_out" -> "Stock Out: Removed $quantity units" 
                    "stock_take" -> "Stock Take: Set to $quantity units"
                    else -> "Stock Update: $changeType ($quantity units)"
                }

                // Log the activity
                realtimeService.addActivity(
                    orgId = orgId,
                    userId = currentUser.email ?: currentUser.uid,
                    action = action,
                    itemId = itemId,
                    itemName = itemName,
                    quantity = newQuantity
                )

                Log.d(TAG, "📱 Stock activity logged: $action for $itemName")
            } else {
                Log.e(TAG, "❌ Context not available for activity logging")
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Failed to log stock activity", e)
        }
    }

    // TODO: Implement proper session detection later
    // For now, removed to fix compilation issues

    // Record stock take scan in active session
    private fun recordStockTakeScan(orgId: String, sessionId: String, stockId: String, scannedQuantity: Int, reason: String) {
        val userEmail = auth.currentUser?.email ?: "unknown@example.com"
        val userName = auth.currentUser?.displayName ?: userEmail.substringBefore("@")
        val deviceId = "apk_${android.provider.Settings.Secure.getString(
            context.contentResolver, 
            android.provider.Settings.Secure.ANDROID_ID
        )}"
        
        Log.d(TAG, "📋 Recording stock take scan in session: $sessionId for item: $stockId")
        
        // Update the Realtime Database session with scanned item
        val database = FirebaseDatabase.getInstance()
    // Canonical dashboard path uses: organizations/{orgId}/stockTakeSessions/{sessionId}
    // Legacy path (previous APK + server scan endpoint): stockTakeSessions/{orgId}/{sessionId}
    // Write to both until all clients migrate.
    val sessionRefCanonical = database.getReference("organizations/$orgId/stockTakeSessions/$sessionId")
    val sessionRefLegacy = database.getReference("stockTakeSessions/$orgId/$sessionId")
        
        // Get item details first  
        firestore.collection("organizations")
            .document(orgId)
            .collection("inventory")
            .document(stockId)
            .get()
            .addOnSuccessListener { document ->
                if (document.exists()) {
                    val itemName = document.getString("name") ?: "Unknown Item"
                    val sku = document.getString("sku") ?: "Unknown SKU"
                    val expectedQuantity = (document.getLong("stock"))?.toInt() ?: 0
                    
                    Log.d(TAG, "📋 Stock take scan recorded: $itemName ($scannedQuantity counted, $expectedQuantity expected)")
                    
                    // ⚠️ APK ONLY writes to RTDB session (NOT directly to Firestore inventory/stockTakeEntries) 
                    // Dashboard admin approval workflow will handle Firestore writes
                    val scannedItem = mapOf(
                        "stockId" to stockId,
                        "itemName" to itemName,
                        "sku" to sku,
                        "scannedQuantity" to scannedQuantity,
                        "expectedQuantity" to expectedQuantity,
                        "scannedBy" to userEmail,
                        "scannedByName" to userName,
                        "scannedAt" to System.currentTimeMillis(),
                        "deviceId" to deviceId,
                        "variance" to (scannedQuantity - expectedQuantity),
                        "reason" to reason
                    )
                    
                    // Add to session's scannedItems (use sanitized SKU as key for duplicate detection)
                    // Write scanned item to both paths (best-effort)  
                    val sanitizedSKU = sanitizeSKU(sku)
                    sessionRefCanonical.child("scannedItems").child(sanitizedSKU).setValue(scannedItem)
                        .addOnSuccessListener { Log.d(TAG, "✅ Canonical session updated: $itemName (SKU: $sku)") }
                        .addOnFailureListener { e -> Log.e(TAG, "❌ Failed canonical session write", e) }
                    sessionRefLegacy.child("scannedItems").child(sanitizedSKU).setValue(scannedItem)
                        .addOnSuccessListener { Log.d(TAG, "✅ Legacy session mirror: $itemName (SKU: $sku)") }
                        .addOnFailureListener { e -> Log.w(TAG, "⚠️ Legacy session mirror failed", e) }

                    // Add this device to participantDevices if not already present
                    sessionRefCanonical.child("participantDevices").get().addOnSuccessListener { snapshot ->
                        val existingDevices = mutableListOf<String>()
                        
                        // Handle different data structures (List or ArrayList)
                        when (val value = snapshot.value) {
                            is List<*> -> {
                                value.filterIsInstance<String>().forEach { existingDevices.add(it) }
                            }
                            is ArrayList<*> -> {
                                value.filterIsInstance<String>().forEach { existingDevices.add(it) }
                            }
                            null -> {
                                // No devices yet
                            }
                        }
                        
                        if (!existingDevices.contains(deviceId)) {
                            existingDevices.add(deviceId)
                            sessionRefCanonical.child("participantDevices").setValue(existingDevices)
                                .addOnSuccessListener { 
                                    Log.d(TAG, "📱 Device added to canonical session participants: $deviceId (Total: ${existingDevices.size})")
                                }
                            sessionRefLegacy.child("participantDevices").setValue(existingDevices)
                                .addOnSuccessListener { 
                                    Log.d(TAG, "📱 Device added to legacy session participants: $deviceId")
                                }
                        } else {
                            Log.d(TAG, "📱 Device already in session participants: $deviceId")
                        }
                    }.addOnFailureListener { e ->
                        Log.e(TAG, "❌ Failed to add device to participants", e)
                    }

                    // Update session statistics on both
                    val now = System.currentTimeMillis()
                    sessionRefCanonical.child("lastActivity").setValue(now)
                    sessionRefLegacy.child("lastActivity").setValue(now)
                    try {
                        sessionRefCanonical.child("totalItemsScanned").setValue(com.google.firebase.database.ServerValue.increment(1))
                        sessionRefLegacy.child("totalItemsScanned").setValue(com.google.firebase.database.ServerValue.increment(1))
                    } catch (incErr: Exception) {
                        Log.w(TAG, "⚠️ Increment not supported, skipping totalItemsScanned", incErr)
                    }
                    
                    // Log activity for the scan
                    logStockTakeActivity(orgId, stockId, itemName, scannedQuantity, expectedQuantity, sessionId)
                    
                } else {
                    Log.e(TAG, "❌ Item not found for stock take scan: $stockId")
                }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Failed to get item details for stock take scan", e)
            }
    }
    
    // Log stock take activity
    private fun logStockTakeActivity(orgId: String, stockId: String, itemName: String, scannedQuantity: Int, expectedQuantity: Int, sessionId: String) {
        val userEmail = auth.currentUser?.email ?: "unknown@example.com"
        val variance = scannedQuantity - expectedQuantity
        
        val activity = mapOf(
            "user" to userEmail,
            "action" to "stock_take_scan",
            "timestamp" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            "details" to mapOf(
                "sessionId" to sessionId,
                "itemName" to itemName,
                "scannedQuantity" to scannedQuantity,
                "expectedQuantity" to expectedQuantity,
                "variance" to variance,
                "source" to "mobile_session"
            )
        )
        
        firestore.collection("organizations")
            .document(orgId)
            .collection("activityLogs")
            .add(activity)
            .addOnSuccessListener {
                Log.d(TAG, "✅ Stock take scan activity logged: $itemName")
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Failed to log stock take scan activity", e)
            }
    }
    
    // Check both Firestore and Realtime Database for active stock take sessions (hybrid approach)
    fun checkForActiveStockTakeSession(context: Context, callback: (String?, String?) -> Unit) {
        val orgId = getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.e(TAG, "No organization ID found for session check")
            callback(null, null)
            return
        }
        
        // First check Firestore (new backend architecture)
        firestore.collection("organizations")
            .document(orgId)
            .collection("stockTakeSessions")
            .whereEqualTo("active", true)
            .whereEqualTo("status", "active")
            .limit(1)
            .get()
            .addOnSuccessListener { documents ->
                if (!documents.isEmpty) {
                    val activeSession = documents.documents[0]
                    val sessionId = activeSession.id
                    Log.d(TAG, "🔗 Found ACTIVE session in Firestore: $sessionId")
                    callback(sessionId, orgId)
                } else {
                    // Fallback to Realtime Database (legacy support)
                    Log.d(TAG, "🔍 No active sessions in Firestore, checking RTDB...")
                    checkRTDBForActiveSession(orgId, callback)
                }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Failed to check Firestore for active sessions, trying RTDB", e)
                checkRTDBForActiveSession(orgId, callback)
            }
    }
    
    private fun checkRTDBForActiveSession(orgId: String, callback: (String?, String?) -> Unit) {
        val database = FirebaseDatabase.getInstance()
        val sessionsRef = database.getReference("organizations/$orgId/stockTakeSessions")
        
        sessionsRef.get().addOnSuccessListener { snapshot ->
            if (snapshot.exists()) {
                var foundActiveSession: Pair<String, String>? = null
                
                // Iterate through all sessions to find an ACTIVE one
                snapshot.children.forEach { sessionSnapshot ->
                    val status = sessionSnapshot.child("status").getValue(String::class.java)
                    val sessionId = sessionSnapshot.child("id").getValue(String::class.java)
                    
                    if (status == "ACTIVE" && !sessionId.isNullOrEmpty()) {
                        foundActiveSession = Pair(sessionId, orgId)
                        Log.d(TAG, "🔗 Found ACTIVE session in RTDB: $sessionId")
                        return@forEach
                    }
                }
                
                if (foundActiveSession != null) {
                    callback(foundActiveSession!!.first, foundActiveSession!!.second)
                } else {
                    Log.d(TAG, "🔍 No ACTIVE sessions found in RTDB either")
                    callback(null, null)
                }
            } else {
                Log.d(TAG, "🔍 No sessions exist in RTDB")
                callback(null, null)
            }
        }.addOnFailureListener { e ->
            Log.e(TAG, "❌ Failed to check RTDB for active sessions", e)
            callback(null, null)
        }
    }
    
    // Check if an item has already been scanned in the current session
    fun checkIfItemAlreadyScanned(
        itemSKU: String,
        callback: (Boolean, String?) -> Unit
    ) {
        val sharedPrefs = context.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
        val activeSessionId = sharedPrefs.getString("activeStockTakeSessionId", null)
        val orgId = getCurrentOrganizationId()
        
        if (activeSessionId.isNullOrEmpty() || orgId.isNullOrBlank()) {
            callback(false, null)
            return
        }
        
        val database = FirebaseDatabase.getInstance()
        val sessionRef = database.getReference("organizations/$orgId/stockTakeSessions/$activeSessionId")
        
        // Sanitize SKU for Firebase path
        val sanitizedSKU = sanitizeSKU(itemSKU)
        sessionRef.child("scannedItems").child(sanitizedSKU).get()
            .addOnSuccessListener { snapshot ->
                if (snapshot.exists()) {
                    val scannedBy = snapshot.child("scannedBy").getValue(String::class.java)
                    val scannedByName = snapshot.child("scannedByName").getValue(String::class.java)
                    Log.d(TAG, "⚠️ Item $itemSKU already scanned by: $scannedByName")
                    callback(true, scannedByName ?: scannedBy ?: "Unknown User")
                } else {
                    callback(false, null)
                }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Failed to check if item already scanned", e)
                callback(false, null)
            }
    }
    
    // Get all active stock take sessions for the organization (for UI display)
    fun getActiveStockTakeSessions(orgId: String, callback: (List<Map<String, Any>>) -> Unit) {
        Log.d(TAG, "📋 Getting active stock take sessions for org: $orgId")
        
        // Check Firestore first (new backend)
        firestore.collection("organizations")
            .document(orgId)
            .collection("stockTakeSessions")
            .whereEqualTo("active", true)
            .orderBy("createdAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .get()
            .addOnSuccessListener { documents ->
                val sessions = mutableListOf<Map<String, Any>>()
                for (document in documents) {
                    val sessionData = document.data.toMutableMap()
                    sessionData["id"] = document.id
                    sessions.add(sessionData)
                    Log.d(TAG, "📋 Found active session: ${document.id} - ${sessionData["name"]}")
                }
                
                if (sessions.isNotEmpty()) {
                    callback(sessions)
                } else {
                    // Fallback to RTDB if no Firestore sessions found
                    Log.d(TAG, "🔍 No Firestore sessions, checking RTDB...")
                    getRTDBStockTakeSessions(orgId, callback)
                }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Error getting Firestore sessions, trying RTDB", e)
                getRTDBStockTakeSessions(orgId, callback)
            }
    }
    
    private fun getRTDBStockTakeSessions(orgId: String, callback: (List<Map<String, Any>>) -> Unit) {
        val database = FirebaseDatabase.getInstance()
        val sessionsRef = database.getReference("organizations/$orgId/stockTakeSessions")
        
        sessionsRef.addListenerForSingleValueEvent(object : com.google.firebase.database.ValueEventListener {
            override fun onDataChange(dataSnapshot: com.google.firebase.database.DataSnapshot) {
                val sessions = mutableListOf<Map<String, Any>>()
                for (sessionSnapshot in dataSnapshot.children) {
                    val sessionData = sessionSnapshot.value as? Map<String, Any>
                    if (sessionData != null) {
                        val mutableSessionData = sessionData.toMutableMap()
                        mutableSessionData["id"] = sessionSnapshot.key!!
                        
                        // Only include active sessions
                        val status = sessionData["status"] as? String
                        val active = sessionData["active"] as? Boolean
                        if (status == "active" || active == true) {
                            sessions.add(mutableSessionData)
                        }
                    }
                }
                callback(sessions)
            }
            
            override fun onCancelled(databaseError: com.google.firebase.database.DatabaseError) {
                Log.e(TAG, "❌ Error loading RTDB sessions: ${databaseError.message}")
                callback(emptyList())
            }
        })
    }
    
    // Method to test connectivity and sync with dashboard sessions
    fun refreshStockTakeSessions(context: Context, callback: (List<Map<String, Any>>) -> Unit) {
        val orgId = getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.e(TAG, "❌ No organization ID found for session refresh")
            callback(emptyList())
            return
        }
        
        Log.d(TAG, "🔄 Refreshing stock take sessions from dashboard...")
        getActiveStockTakeSessions(orgId) { sessions ->
            if (sessions.isNotEmpty()) {
                Log.d(TAG, "✅ Successfully loaded ${sessions.size} active sessions from dashboard")
                
                // Optionally show a toast or notification
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    android.widget.Toast.makeText(
                        context, 
                        "Found ${sessions.size} active stock take sessions", 
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                }
            } else {
                Log.d(TAG, "ℹ️ No active sessions found in dashboard")
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    android.widget.Toast.makeText(
                        context, 
                        "No active stock take sessions found", 
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                }
            }
            callback(sessions)
        }
    }
}
