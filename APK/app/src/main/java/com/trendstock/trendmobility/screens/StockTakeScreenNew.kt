package com.trendstock.trendmobility.screens

import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel
import com.trendstock.trendmobility.api.ApiClient
import com.trendstock.trendmobility.api.StockTakeScanRequest
import com.trendstock.trendmobility.auth.AuthManager
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.trendstock.trendmobility.api.InventoryItem
import com.trendstock.trendmobility.services.FirebaseService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import com.trendstock.trendmobility.viewmodels.StockViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.*

data class OfflineStockTakeItem(
    val itemId: String,
    val itemName: String,
    val sku: String,
    val scannedQuantity: Int,
    val expectedQuantity: Int = 0,
    val scannedAt: Long = System.currentTimeMillis(),
    val deviceId: String,
    val deviceName: String = android.os.Build.MODEL
) {
    val variance: Int get() = scannedQuantity - expectedQuantity
}

data class OfflineStockTakeSession(
    val id: String,
    val startedAt: Long,
    val endedAt: Long? = null,
    val status: String, // ACTIVE, COMPLETED, SYNCED
    val deviceName: String,
    val syncedAt: Long? = null,
    val items: MutableList<OfflineStockTakeItem> = mutableListOf()
)

data class SavedSession(
    val sessionId: String,
    val displayTitle: String,
    val startedAt: Long,
    val endedAt: Long,
    val itemCount: Int,
    val status: String,
    val syncedAt: Long?
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StockTakeScreenNew(
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val viewModel: StockViewModel = viewModel()
    val keyboardController = LocalSoftwareKeyboardController.current
    val scope = rememberCoroutineScope()
    
    var searchQuery by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<InventoryItem>>(emptyList()) }
    var selectedItem by remember { mutableStateOf<InventoryItem?>(null) }
    var showDialog by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var hasSearched by remember { mutableStateOf(false) }
    var quantityInput by remember { mutableStateOf("") }
    var showDuplicateScanDialog by remember { mutableStateOf(false) }
    var duplicateExistingItem by remember { mutableStateOf<OfflineStockTakeItem?>(null) }
    
    // Offline stock take state
    var currentSession by remember { mutableStateOf<OfflineStockTakeSession?>(null) }
    var showSessionEndDialog by remember { mutableStateOf(false) }
    var showEndConfirmDialog by remember { mutableStateOf(false) }
    var savedSessions by remember { mutableStateOf<List<SavedSession>>(emptyList()) }
    var selectedSavedSession by remember { mutableStateOf<SavedSession?>(null) }
    var showSavedSessionDialog by remember { mutableStateOf(false) }
    var showExitDialog by remember { mutableStateOf(false) }
    var showCrossDeviceBlockDialog by remember { mutableStateOf(false) }
    var crossDeviceConflict by remember { mutableStateOf<Map<String, Any>?>(null) }
    
    // Intercept back button during active session
    BackHandler(enabled = currentSession?.status == "ACTIVE") {
        showExitDialog = true
    }
    
    // Load existing session and saved sessions on start
    LaunchedEffect(Unit) {
        currentSession = loadOfflineSession(context)
        savedSessions = loadSavedSessions(context)
    }
    
    // Observe stocks for search
    val allStocks: List<InventoryItem> by viewModel.stocks.observeAsState(emptyList())
    
    LaunchedEffect(searchQuery, allStocks) {
        if (searchQuery.length >= 2) {
            delay(300) // Debounce
            isLoading = true
            hasSearched = true
            try {
                searchResults = viewModel.searchStocks(searchQuery)
            } catch (e: Exception) {
                searchResults = emptyList()
            } finally {
                isLoading = false
            }
        } else {
            searchResults = emptyList()
            hasSearched = false
            isLoading = false
        }
    }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
            }
            Text(
                text = "Stock Take",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.width(48.dp)) // Balance the IconButton
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Session Control Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = if (currentSession?.status == "ACTIVE") 
                    MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceVariant
            )
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = if (currentSession?.status == "ACTIVE") "📋 Stock Take Active" else "📋 Stock Take",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium
                        )
                        if (currentSession != null) {
                            Text(
                                text = "${currentSession?.items?.size ?: 0} items scanned",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    
                    // Start/End Button
                    if (currentSession?.status == "ACTIVE") {
                        Button(
                            onClick = { showEndConfirmDialog = true },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Icon(Icons.Default.Close, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("End")
                        }
                    } else {
                        Button(
                            onClick = {
                                scope.launch {
                                    currentSession = startOfflineSession(context)
                                }
                            },
                            enabled = currentSession?.status != "ACTIVE",
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Start", fontSize = 14.sp)
                        }
                    }
                }
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Search field (only enabled during active session)
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            label = { Text("Search items to scan") },
            modifier = Modifier.fillMaxWidth(),
            enabled = currentSession?.status == "ACTIVE",
            trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                    IconButton(onClick = { searchQuery = "" }) {
                        Icon(Icons.Default.Close, contentDescription = "Clear search")
                    }
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(
                onSearch = { keyboardController?.hide() }
            )
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Content based on session state
        if (currentSession?.status != "ACTIVE") {
            // Show saved sessions or inactive state
            if (savedSessions.isNotEmpty()) {
                Column(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Saved Sessions",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    LazyColumn {
                        items(savedSessions) { session ->
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp)
                                    .clickable {
                                        selectedSavedSession = session
                                        showSavedSessionDialog = true
                                    },
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                                )
                            ) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(16.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(
                                            text = session.displayTitle,
                                            fontSize = 16.sp,
                                            fontWeight = FontWeight.Medium
                                        )
                                        Text(
                                            text = "${session.itemCount} items",
                                            fontSize = 14.sp,
                                            color = MaterialTheme.colorScheme.primary,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = when (session.status) {
                                            "SYNCED" -> "Synced to dashboard"
                                            "PAUSED" -> "⏸ Paused — tap to resume"
                                            else -> "Pending sync"
                                        },
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = when (session.status) {
                                            "SYNCED" -> MaterialTheme.colorScheme.primary
                                            "PAUSED" -> MaterialTheme.colorScheme.error
                                            else -> MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
                                        }
                                    )
                                    session.syncedAt?.let { syncedAt ->
                                        Spacer(modifier = Modifier.height(2.dp))
                                        Text(
                                            text = "Synced on ${SimpleDateFormat("MMM dd, yyyy HH:mm", Locale.getDefault()).format(Date(syncedAt))}",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.6f)
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = "Tap to sync, export, or delete",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "🚀",
                        fontSize = 48.sp
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Ready to Start Stock Take",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Medium,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Start a new stock take session to begin scanning items. All data will be saved locally and can be synced later.",
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        } else {
            // Show active session content
            if (isLoading) {
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (hasSearched && searchResults.isEmpty() && searchQuery.length >= 2) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("❌", fontSize = 32.sp)
                    Text(
                        text = "No items found",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = "\"$searchQuery\" is not available in stock",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else if (searchResults.isNotEmpty()) {
                LazyColumn {
                    items(searchResults) { item ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .clickable {
                                    val existingEntry = currentSession?.items?.find { it.itemId == item.itemId }
                                    if (existingEntry != null) {
                                        selectedItem = item
                                        duplicateExistingItem = existingEntry
                                        showDuplicateScanDialog = true
                                    } else {
                                        // Check cross-device conflict before showing quantity dialog
                                        scope.launch {
                                            val orgId = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId()
                                            val session = currentSession
                                            if (!orgId.isNullOrBlank() && session != null) {
                                                // Cross-device conflict check removed (Firestore no longer used).
                                                // Backend upsert on (session_id, item_id) handles duplicates safely.
                                            }
                                            quantityInput = ""
                                            selectedItem = item
                                            showDialog = true
                                        }
                                    }
                                }
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp)
                            ) {
                                Text(
                                    text = item.name,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Medium
                                )
                                Text(
                                    text = "SKU: ${item.sku}",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            } else if (currentSession?.items?.isNotEmpty() == true) {
                // Show scanned items
                LazyColumn {
                    items(currentSession?.items ?: emptyList()) { scannedItem ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.secondaryContainer
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = scannedItem.itemName,
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                    Text(
                                        text = "SKU: ${scannedItem.sku}",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer
                                    )
                                }
                                Text(
                                    text = "${scannedItem.scannedQuantity}",
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Quantity input dialog
    if (showDialog && selectedItem != null && currentSession?.status == "ACTIVE") {
        Dialog(onDismissRequest = { showDialog = false }) {
            Card {
                Column(
                    modifier = Modifier.padding(24.dp)
                ) {
                    Text(
                        text = "Scan Item",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = selectedItem?.name ?: "Unknown Item",
                        fontSize = 16.sp
                    )
                    Text(
                        text = "SKU: ${selectedItem?.sku ?: "Unknown"}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    OutlinedTextField(
                        value = quantityInput,
                        onValueChange = { quantityInput = it },
                        label = { Text("Quantity Found") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth()
                    )
                    
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = { showDialog = false; quantityInput = "" }) {
                            Text("Cancel")
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = {
                                val qty = quantityInput.toIntOrNull() ?: 0
                                val session = currentSession
                                val item = selectedItem
                                if (session != null && item != null) {
                                    scope.launch {
                                        addItemToSession(context, session, item, qty)
                                        currentSession = loadOfflineSession(context)
                                    }
                                }
                                showDialog = false
                                quantityInput = ""
                                selectedItem = null
                                searchQuery = ""
                            }
                        ) {
                            Text("Save")
                        }
                    }
                }
            }
        }
    }

    // Duplicate scan dialog
    if (showDuplicateScanDialog && duplicateExistingItem != null && selectedItem != null) {
        AlertDialog(
            onDismissRequest = {
                showDuplicateScanDialog = false
                duplicateExistingItem = null
                selectedItem = null
            },
            title = { Text("Already Scanned") },
            text = {
                Text(
                    "${selectedItem?.name} was already scanned with a quantity of " +
                    "${duplicateExistingItem?.scannedQuantity}. Do you want to scan it again?"
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        quantityInput = duplicateExistingItem?.scannedQuantity?.toString() ?: ""
                        showDuplicateScanDialog = false
                        duplicateExistingItem = null
                        showDialog = true
                    }
                ) {
                    Text("Re-scan")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showDuplicateScanDialog = false
                        duplicateExistingItem = null
                        selectedItem = null
                    }
                ) {
                    Text("Cancel")
                }
            }
        )
    }

    // Cross-device conflict dialog — blocks scanning an item already claimed by another device
    if (showCrossDeviceBlockDialog && selectedItem != null && crossDeviceConflict != null) {
        val claimedBy = crossDeviceConflict!!["userName"] as? String ?: "another user"
        AlertDialog(
            onDismissRequest = {
                showCrossDeviceBlockDialog = false
                selectedItem = null
                crossDeviceConflict = null
            },
            title = { Text("Already Scanned by Another Device") },
            text = {
                Text(
                    "${selectedItem?.name} (${selectedItem?.sku}) has already been scanned " +
                    "by $claimedBy on another device during this stock take. " +
                    "You cannot scan this item again."
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showCrossDeviceBlockDialog = false
                        selectedItem = null
                        crossDeviceConflict = null
                    }
                ) {
                    Text("OK")
                }
            }
        )
    }

    // End confirmation dialog
    if (showEndConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showEndConfirmDialog = false },
            title = { Text("End Stock Take Session?") },
            text = { 
                Text("Are you sure you want to end this session? You have scanned ${currentSession?.items?.size ?: 0} items.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            val session = currentSession
                            if (session != null) {
                                val completedSession = session.copy(
                                    status = "COMPLETED",
                                    endedAt = System.currentTimeMillis()
                                )
                                saveSessionToList(context, completedSession)
                                val endUserName = AuthManager.getEmail()?.substringBefore("@") ?: "Unknown User"
                                broadcastStockTakeNotification(context, completedSession.id, "ENDED", completedSession.deviceName, endUserName)
                                // Session status is managed server-side via the backend API.
                                currentSession = null
                                deleteActiveSession(context)
                                savedSessions = loadSavedSessions(context)
                            }
                            showEndConfirmDialog = false
                        }
                    }
                ) {
                    Text("Yes, End Session")
                }
            },
            dismissButton = {
                TextButton(onClick = { showEndConfirmDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
    
    // Exit dialog (back button / navigating away during active session)
    if (showExitDialog && currentSession?.status == "ACTIVE") {
        AlertDialog(
            onDismissRequest = { showExitDialog = false },
            title = { Text("Stock Take in Progress") },
            text = {
                Text("You have scanned ${currentSession?.items?.size ?: 0} items. What would you like to do?")
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            val session = currentSession
                            if (session != null) {
                                val completedSession = session.copy(
                                    status = "COMPLETED",
                                    endedAt = System.currentTimeMillis()
                                )
                                saveSessionToList(context, completedSession)
                                val endUserName = AuthManager.getEmail()?.substringBefore("@") ?: "Unknown User"
                                broadcastStockTakeNotification(context, completedSession.id, "ENDED", completedSession.deviceName, endUserName)
                                // Session status is managed server-side via the backend API.
                                currentSession = null
                                deleteActiveSession(context)
                                savedSessions = loadSavedSessions(context)
                            }
                            showExitDialog = false
                            onBack()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("End Session")
                }
            },
            dismissButton = {
                Row {
                    TextButton(
                        onClick = {
                            scope.launch {
                                val session = currentSession
                                if (session != null) {
                                    val pausedSession = session.copy(status = "PAUSED")
                                    saveSessionToList(context, pausedSession)
                                    currentSession = null
                                    deleteActiveSession(context)
                                    savedSessions = loadSavedSessions(context)
                                }
                                showExitDialog = false
                                onBack()
                            }
                        }
                    ) {
                        Text("Pause")
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    TextButton(onClick = { showExitDialog = false }) {
                        Text("Cancel")
                    }
                }
            }
        )
    }

    // Saved session options dialog
    if (showSavedSessionDialog && selectedSavedSession != null) {
        val session = selectedSavedSession!!
        val isSynced = session.status == "SYNCED"
        val isPaused = session.status == "PAUSED"
        val isCompleted = session.status == "COMPLETED"
        val canActOnSession = !isPaused // Export/Sync/Delete greyed out when paused
        Dialog(onDismissRequest = { showSavedSessionDialog = false }) {
            Card {
                Column(
                    modifier = Modifier.padding(24.dp)
                ) {
                    Text(
                        text = session.displayTitle,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "${session.itemCount} items scanned",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (isPaused) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Session paused — resume to end, export, or sync.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    // Resume button (only for paused sessions, greyed if already active or completed)
                    Button(
                        onClick = {
                            if (currentSession?.status == "ACTIVE") {
                                Toast.makeText(context, "End the current session first", Toast.LENGTH_SHORT).show()
                                return@Button
                            }
                            scope.launch {
                                val fullSession = loadSavedSessionById(context, session.sessionId)
                                if (fullSession != null) {
                                    val resumed = fullSession.copy(status = "ACTIVE")
                                    saveOfflineSession(context, resumed)
                                    currentSession = resumed
                                    removeSavedSession(context, session.sessionId)
                                    savedSessions = loadSavedSessions(context)
                                    Toast.makeText(context, "Session resumed", Toast.LENGTH_SHORT).show()
                                }
                            }
                            showSavedSessionDialog = false
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = isPaused,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant
                        )
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (isPaused) "Resume Session" else "Resume")
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    // Export button
                    Button(
                        onClick = {
                            scope.launch {
                                val fullSession = loadSavedSessionById(context, session.sessionId)
                                if (fullSession != null) {
                                    exportSessionToCSV(context, fullSession)
                                }
                            }
                            showSavedSessionDialog = false
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = canActOnSession
                    ) {
                        Icon(Icons.Default.ArrowBack, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Export to CSV")
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    // Sync button
                    Button(
                        onClick = {
                            scope.launch {
                                val fullSession = loadSavedSessionById(context, session.sessionId)
                                if (fullSession != null) {
                                    val synced = syncSessionToDashboard(context, fullSession)
                                    if (synced) {
                                        Log.d("StockTakeScreen", "✅ Session synced to dashboard successfully: ${fullSession.id}")
                                        
                                        val updatedSession = fullSession.copy(
                                            status = "SYNCED",
                                            syncedAt = System.currentTimeMillis()
                                        )
                                        saveSessionToList(context, updatedSession)
                                    } else {
                                        Log.e("StockTakeScreen", "❌ Failed to sync session: ${fullSession.id}")
                                    }
                                    savedSessions = loadSavedSessions(context)
                                    Toast.makeText(
                                        context,
                                        if (synced) "Session synced to dashboard" else "Sync failed. Please try again.",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                }
                            }
                            showSavedSessionDialog = false
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = canActOnSession && !isSynced
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (isSynced) "Already Synced" else "Sync to Dashboard")
                    }
                    if (isSynced) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "This session has already been synced to the dashboard.",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    // Delete button
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                removeSavedSession(context, session.sessionId)
                                savedSessions = loadSavedSessions(context)
                                Toast.makeText(context, "Session deleted", Toast.LENGTH_SHORT).show()
                            }
                            showSavedSessionDialog = false
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = canActOnSession,
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Delete Session")
                    }
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    TextButton(
                        onClick = { showSavedSessionDialog = false },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Cancel")
                    }
                }
            }
        }
    }
    
    // Session end dialog (deprecated - keeping for compatibility)
    if (showSessionEndDialog) {
        Dialog(onDismissRequest = { showSessionEndDialog = false }) {
            Card {
                Column(
                    modifier = Modifier.padding(24.dp)
                ) {
                    Text(
                        text = "End Stock Take Session",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "You have scanned ${currentSession?.items?.size ?: 0} items. What would you like to do?",
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    
                    // Export to CSV button
                    Button(
                        onClick = {
                            scope.launch {
                                val session = currentSession
                                if (session != null) {
                                    exportSessionToCSV(context, session)
                                    // Don't close dialog or end session - let user decide to sync or delete
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.ArrowBack, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Export to CSV")
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    // Sync to Dashboard button
                    Button(
                        onClick = {
                            scope.launch {
                                val session = currentSession
                                if (session != null) {
                                    val synced = syncSessionToDashboard(context, session)
                                    if (synced) {
                                        Log.d("StockTakeScreen", "✅ Session synced to dashboard successfully: ${session.id}")
                                        
                                        // Mark as synced instead of deleting
                                        val updatedSession = session.copy(
                                            status = "SYNCED", 
                                            syncedAt = System.currentTimeMillis()
                                        )
                                        saveSessionToList(context, updatedSession)
                                    } else {
                                        Log.e("StockTakeScreen", "❌ Failed to sync session: ${session.id}")
                                    }
                                    savedSessions = loadSavedSessions(context)
                                    Toast.makeText(
                                        context,
                                        if (synced) "Session synced to dashboard" else "Sync failed. Please try again.",
                                        Toast.LENGTH_SHORT
                                    ).show()
                                    endSession(context, session)
                                }
                                currentSession = null
                                showSessionEndDialog = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sync to Dashboard")
                    }
                    
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    // Delete button
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                val session = currentSession
                                if (session != null) {
                                    deleteSession(context, session)
                                }
                                currentSession = null
                                showSessionEndDialog = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Delete Session")
                    }
                    
                    Spacer(modifier = Modifier.height(16.dp))
                    
                    TextButton(
                        onClick = { showSessionEndDialog = false },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Cancel")
                    }
                }
            }
        }
    }
}

// ── SharedPreferences namespacing ──────────────────────────────────────────
// Keys are scoped to the current user+org so that different users on the same
// physical device cannot see each other's stock-take sessions.

private fun activeSessionPrefsName(context: Context): String {
    val uid   = AuthManager.getUserId() ?: "anonymous"
    val orgId = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId() ?: "noorg"
    return "StockTakeOffline_${uid}_${orgId}"
}

private fun savedSessionsPrefsName(context: Context): String {
    val uid   = AuthManager.getUserId() ?: "anonymous"
    val orgId = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId() ?: "noorg"
    return "SavedSessions_${uid}_${orgId}"
}

// Helper functions for offline session management
private suspend fun startOfflineSession(context: Context): OfflineStockTakeSession {
    val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    val deviceName = android.os.Build.MODEL
    
    // Generate professional session ID: Stocktake_YYYYMMDD_HHMMSS_DeviceID
    val now = System.currentTimeMillis()
    val dateFormat = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault())
    val formattedDateTime = dateFormat.format(Date(now))
    val shortDeviceId = deviceId.takeLast(6)
    val sessionId = "Stocktake_${formattedDateTime}_$shortDeviceId"
    
    val session = OfflineStockTakeSession(
        id = sessionId,
        startedAt = now,
        status = "ACTIVE",
        deviceName = deviceName
    )
    
    saveOfflineSession(context, session)
    
    // Register device as active on dashboard
    registerDeviceAsActive(context, session)

    // Session is tracked locally (SharedPreferences) and synced to backend on completion.
    val userName = AuthManager.getEmail()?.substringBefore("@") ?: "Unknown User"
    broadcastStockTakeNotification(context, session.id, "STARTED", session.deviceName, userName)
    
    Log.d("StockTakeScreen", "📋 Started offline session: ${session.id}")
    return session
}

private suspend fun addItemToSession(
    context: Context, 
    session: OfflineStockTakeSession, 
    item: InventoryItem, 
    quantity: Int
) {
    val deviceId = android.provider.Settings.Secure.getString(
        context.contentResolver,
        android.provider.Settings.Secure.ANDROID_ID
    )
    
    val stockTakeItem = OfflineStockTakeItem(
        itemId = item.itemId,
        itemName = item.name,
        sku = item.sku,
        scannedQuantity = quantity,
        expectedQuantity = item.quantityAvailable,
        deviceId = deviceId
    )
    
    session.items.removeAll { it.itemId == stockTakeItem.itemId }
    session.items.add(stockTakeItem)
    saveOfflineSession(context, session)
    
    // Update device progress on dashboard
    updateDeviceProgress(context, session)
    
    // Live sync scan event to Firestore for dashboard monitoring
    syncScanToFirestore(context, session.id, stockTakeItem)
    
    Log.d("StockTakeScreen", "📦 Added item to session: ${item.name} (${quantity})")
}

private fun loadOfflineSession(context: Context): OfflineStockTakeSession? {
    return try {
        val sharedPrefs = context.getSharedPreferences(activeSessionPrefsName(context), Context.MODE_PRIVATE)
        val sessionJson = sharedPrefs.getString("current_session", null)
        if (sessionJson != null) {
            Gson().fromJson(sessionJson, OfflineStockTakeSession::class.java)
        } else null
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Error loading session: ${e.message}")
        null
    }
}

private fun saveOfflineSession(context: Context, session: OfflineStockTakeSession) {
    try {
        val sharedPrefs = context.getSharedPreferences(activeSessionPrefsName(context), Context.MODE_PRIVATE)
        val sessionJson = Gson().toJson(session)
        sharedPrefs.edit().putString("current_session", sessionJson).apply()
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Error saving session: ${e.message}")
    }
}

private suspend fun exportSessionToCSV(context: Context, session: OfflineStockTakeSession) {
    try {
        // Check and request storage permission first
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (context.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != 
                android.content.pm.PackageManager.PERMISSION_GRANTED) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Storage permission required to export CSV. Please grant permission in app settings.", Toast.LENGTH_LONG).show()
                }
                return
            }
        }
        
        val dateFormat = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.getDefault())
        val filename = "StockTake_${dateFormat.format(Date(session.startedAt))}.csv"
        
        // Save to user-accessible Downloads folder
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val stockTakeDir = File(downloadsDir, "StockTake_Exports")
        if (!stockTakeDir.exists()) {
            stockTakeDir.mkdirs()
        }
        
        val csvFile = File(stockTakeDir, filename)
        val writer = FileWriter(csvFile)
        
        // Get current user info
        val currentUser = FirebaseAuth.getInstance().currentUser
        val userName = currentUser?.email?.substringBefore("@") ?: currentUser?.displayName ?: "Unknown User"
        
        // Simple CSV header - essential columns plus user
        writer.append("Stock Take ID,Session Date,Item Name,SKU,Category,Description,")
        writer.append("Expected Quantity,Scanned Quantity,Variance,Variance %,Variance Type,Scanned Date,Scanned Time,Scanned By\n")
        
        val sessionStart = Date(session.startedAt)
        val sessionDate = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(sessionStart)
        
        // Write data for each item
        session.items.forEach { item ->
            val variance = item.scannedQuantity - item.expectedQuantity
            val variancePercent = if (item.expectedQuantity > 0) {
                String.format("%.1f", (variance.toDouble() / item.expectedQuantity * 100))
            } else "0.0"
            
            val varianceType = when {
                variance > 0 -> "Surplus"
                variance < 0 -> "Shortage" 
                else -> "Match"
            }
            
            // Ensure valid date formatting
            val scannedDate = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(item.scannedAt))
            val scannedTime = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(item.scannedAt))
            
            // Build CSV row with proper escaping - essential fields plus variance analysis and user
            val row = listOf(
                session.id,
                sessionDate,
                item.itemName.replace("\"", "\"\""),
                item.sku,
                "Unassigned", // Category placeholder since not in data model
                "", // Description placeholder since not in data model
                item.expectedQuantity.toString(),
                item.scannedQuantity.toString(),
                variance.toString(),
                "$variancePercent%",
                varianceType,
                scannedDate,
                scannedTime,
                userName
            ).joinToString(",") { "\"$it\"" }
            
            writer.append("$row\n")
        }
        
        writer.close()
        Log.d("StockTakeScreen", "✅ CSV exported to: ${csvFile.absolutePath}")
        
        // Show success message with easy-to-find location
        withContext(Dispatchers.Main) {
            Toast.makeText(context, "Stock take exported to Downloads/StockTake_Exports/${csvFile.name}", Toast.LENGTH_LONG).show()
        }
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Error exporting CSV: ${e.message}")
        withContext(Dispatchers.Main) {
            Toast.makeText(context, "Export failed: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }
}

private suspend fun syncSessionToDashboard(context: Context, session: OfflineStockTakeSession): Boolean {
    return try {
        val orgId  = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId()
                     ?: getOrganizationId(context)
        if (orgId.isNullOrBlank()) { Log.e("StockTakeScreen", "❌ No org ID for sync"); return false }

        val token = AuthManager.getAccessToken()
        if (token.isNullOrBlank()) { Log.e("StockTakeScreen", "❌ Not authenticated for sync"); return false }

        val auth = "Bearer $token"

        // Push each scanned item to backend stock-take scan endpoint
        var ok = true
        for (item in session.items) {
            val resp = ApiClient.mobileService.recordStockTakeScan(
                auth = auth,
                body = StockTakeScanRequest(
                    orgId            = orgId,
                    sessionId        = session.id,
                    itemId           = item.itemId,
                    sku              = item.sku,
                    itemName         = item.itemName,
                    countedQuantity  = item.scannedQuantity,
                    expectedQuantity = item.expectedQuantity,
                )
            )
            if (!resp.isSuccessful) {
                Log.w("StockTakeScreen", "⚠️ Scan sync failed for ${item.sku}: ${resp.body()?.message}")
                ok = false
            }
        }

        Log.d("StockTakeScreen", "✅ Session sync complete: ${session.items.size} items, ok=$ok")
        ok
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ syncSessionToDashboard error: ${e.message}")
        false
    }
}

private suspend fun registerDeviceAsActive(context: Context, session: OfflineStockTakeSession) {
    // RTDB removed — device registration is handled by the scan entries written to the backend.
    Log.d("StockTakeScreen", "📱 Session started locally: ${session.id}")
}

private suspend fun updateDeviceProgress(context: Context, session: OfflineStockTakeSession) {
    // RTDB removed — progress is tracked locally and synced on session completion.
    Log.d("StockTakeScreen", "📊 Local progress: ${session.items.size} items scanned")
}

private fun endSession(context: Context, session: OfflineStockTakeSession) {
    val updatedSession = session.copy(
        status = "COMPLETED",
        endedAt = System.currentTimeMillis()
    )
    saveOfflineSession(context, updatedSession)
    
    // RTDB removed — session end is tracked locally; synced to backend on export.
}

private fun deleteSession(context: Context, session: OfflineStockTakeSession) {
    val sharedPrefs = context.getSharedPreferences(activeSessionPrefsName(context), Context.MODE_PRIVATE)
    sharedPrefs.edit().remove("current_session").apply()
    Log.d("StockTakeScreen", "🗑️ Deleted session: ${session.id}")
}

private fun deleteActiveSession(context: Context) {
    val sharedPrefs = context.getSharedPreferences(activeSessionPrefsName(context), Context.MODE_PRIVATE)
    sharedPrefs.edit().remove("current_session").apply()
    Log.d("StockTakeScreen", "🗑️ Deleted active session")
}

private fun saveSessionToList(context: Context, session: OfflineStockTakeSession) {
    try {
        val sharedPrefs = context.getSharedPreferences(savedSessionsPrefsName(context), Context.MODE_PRIVATE)
        val existingSessions = sharedPrefs.getStringSet("session_ids", mutableSetOf())?.toMutableSet() ?: mutableSetOf()

        // Save full session data
        val sessionJson = Gson().toJson(session)
        sharedPrefs.edit().putString("session_${session.id}", sessionJson).apply()

        // Add to session IDs list
        existingSessions.add(session.id)
        sharedPrefs.edit().putStringSet("session_ids", existingSessions).apply()

        Log.d("StockTakeScreen", "💾 Saved session to list: ${session.id}")
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Error saving session to list: ${e.message}")
    }
}

private fun loadSavedSessions(context: Context): List<SavedSession> {
    try {
        val sharedPrefs = context.getSharedPreferences(savedSessionsPrefsName(context), Context.MODE_PRIVATE)
        val sessionIds = sharedPrefs.getStringSet("session_ids", emptySet()) ?: emptySet()
        
        val sessions = mutableListOf<SavedSession>()
        sessionIds.forEach { sessionId ->
            val sessionJson = sharedPrefs.getString("session_$sessionId", null)
            if (sessionJson != null) {
                val session = Gson().fromJson(sessionJson, OfflineStockTakeSession::class.java)
                if (session != null) {
                    val dateFormat = SimpleDateFormat("MMM dd, yyyy HH:mm", Locale.getDefault())
                    val displayTitle = dateFormat.format(Date(session.startedAt))
                    sessions.add(
                        SavedSession(
                            sessionId = session.id,
                            displayTitle = displayTitle,
                            startedAt = session.startedAt,
                            endedAt = session.endedAt ?: System.currentTimeMillis(),
                            itemCount = session.items.size,
                            status = session.status,
                            syncedAt = session.syncedAt
                        )
                    )
                }
            }
        }
        
        return sessions.sortedByDescending { it.startedAt }
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Error loading saved sessions: ${e.message}")
        return emptyList()
    }
}

private fun loadSavedSessionById(context: Context, sessionId: String): OfflineStockTakeSession? {
    try {
        val sharedPrefs = context.getSharedPreferences(savedSessionsPrefsName(context), Context.MODE_PRIVATE)
        val sessionJson = sharedPrefs.getString("session_$sessionId", null)
        return if (sessionJson != null) {
            Gson().fromJson(sessionJson, OfflineStockTakeSession::class.java)
        } else null
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Error loading session by ID: ${e.message}")
        return null
    }
}

private fun removeSavedSession(context: Context, sessionId: String) {
    try {
        val sharedPrefs = context.getSharedPreferences(savedSessionsPrefsName(context), Context.MODE_PRIVATE)
        val sessionIds = sharedPrefs.getStringSet("session_ids", mutableSetOf())?.toMutableSet() ?: mutableSetOf()
        
        // Remove from session IDs list
        sessionIds.remove(sessionId)
        sharedPrefs.edit().putStringSet("session_ids", sessionIds).apply()
        
        // Remove session data
        sharedPrefs.edit().remove("session_$sessionId").apply()
        
        Log.d("StockTakeScreen", "🗑️ Removed saved session: $sessionId")
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Error removing saved session: ${e.message}")
    }
}

// Helper function to get organization ID from preferences
private fun getOrganizationId(context: Context): String? {
    val prefs = context.getSharedPreferences("user_prefs", Context.MODE_PRIVATE)
    return prefs.getString("organization_id", null)
}

private suspend fun syncScanToFirestore(
    context: Context,
    sessionId: String,
    item: OfflineStockTakeItem,
) {
    // Live scan is now posted to the backend; Firestore is no longer used.
    try {
        val orgId = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) return
        val token = AuthManager.getAccessToken() ?: return

        ApiClient.mobileService.recordStockTakeScan(
            auth = "Bearer $token",
            body = StockTakeScanRequest(
                orgId            = orgId,
                sessionId        = sessionId,
                itemId           = item.itemId,
                sku              = item.sku,
                itemName         = item.itemName,
                countedQuantity  = item.scannedQuantity,
                expectedQuantity = item.expectedQuantity,
            )
        )
        Log.d("StockTakeScreen", "📡 Scan posted to backend: ${item.sku}")
    } catch (e: Exception) {
        Log.w("StockTakeScreen", "⚠️ Scan sync failed (offline-first, ok): ${e.message}")
    }
}

private suspend fun broadcastStockTakeNotification(
    context: Context,
    sessionId: String,
    eventType: String,
    deviceName: String,
    userName: String
) {
    try {
        val orgId = com.trendstock.trendmobility.utils.OrganizationManager.getCurrentOrganizationId()
        if (orgId.isNullOrBlank()) {
            Log.e("StockTakeScreen", "❌ Cannot broadcast notification: no org ID")
            return
        }
        val token = AuthManager.getAccessToken() ?: return

        // Post activity to backend; dashboard is notified via FCM from the backend.
        ApiClient.mobileService.logActivity(
            auth = "Bearer $token",
            body = com.trendstock.trendmobility.api.ActivityRequest(
                orgId    = orgId,
                type     = "stock_take_session",
                itemId   = null,
                itemName = null,
                quantity = null,
                action   = if (eventType == "STARTED") "Stock Take Started by $userName on $deviceName"
                           else "Stock Take Ended by $userName on $deviceName",
                details  = mapOf("sessionId" to sessionId, "eventType" to eventType, "deviceName" to deviceName),
            )
        )

        Log.d("StockTakeScreen", "📢 Broadcast notification sent: $eventType for session $sessionId")
    } catch (e: Exception) {
        Log.e("StockTakeScreen", "❌ Failed to broadcast notification: ${e.message}")
    }
}