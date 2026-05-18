package com.trendstock.trendmobility.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.livedata.observeAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel
import com.trendstock.trendmobility.api.InventoryItem
import com.trendstock.trendmobility.viewmodels.StockViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StockInScreen(
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val viewModel: StockViewModel = viewModel()
    val keyboardController = LocalSoftwareKeyboardController.current
    
    var searchQuery by remember { mutableStateOf("") }
    var searchResults by remember { mutableStateOf<List<InventoryItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var hasSearched by remember { mutableStateOf(false) }
    var selectedItem by remember { mutableStateOf<InventoryItem?>(null) }
    var showDialog by remember { mutableStateOf(false) }
    var loadTimedOut by remember { mutableStateOf(false) }

    // Observe all stocks from SQLite cache (populated by StockRepository on init)
    val allStocks: List<InventoryItem> by viewModel.stocks.observeAsState(emptyList())

    // Safety net: if data hasn't arrived after 10 seconds, show actionable error
    LaunchedEffect(allStocks) {
        if (allStocks.isEmpty()) {
            loadTimedOut = false
            kotlinx.coroutines.delay(10_000L)
            if (allStocks.isEmpty()) loadTimedOut = true
        } else {
            loadTimedOut = false
        }
    }

    LaunchedEffect(searchQuery, allStocks) {
        if (searchQuery.length >= 2) {
            delay(300) // Debounce
            isLoading = true
            hasSearched = true
            try {
                // Search in Firebase data using ViewModel
                searchResults = viewModel.searchStocks(searchQuery)
            } catch (e: Exception) {
                searchResults = emptyList()
            } finally {
                isLoading = false
            }
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
                Icon(
                    imageVector = androidx.compose.material.icons.Icons.Default.ArrowBack,
                    contentDescription = "Back"
                )
            }
            Text(
                text = "📥 Stock In",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Spacer(modifier = Modifier.width(48.dp)) // Balance the back button
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Search bar
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            label = { Text("Add stock to items...") },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Type at least 2 characters") },
            trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                    IconButton(onClick = { 
                        searchQuery = ""
                        searchResults = emptyList()
                        hasSearched = false
                    }) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Clear search"
                        )
                    }
                }
            },
            keyboardOptions = KeyboardOptions(
                imeAction = ImeAction.Search
            ),
            keyboardActions = KeyboardActions(
                onSearch = {
                    keyboardController?.hide()
                    // Trigger search immediately
                    if (searchQuery.length >= 2) {
                        // Search is already handled by LaunchedEffect
                    }
                }
            )
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        // Loading indicator
        if (isLoading) {
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        }
        
        // Loading / error state when cache is empty
        if (allStocks.isEmpty() && !hasSearched && searchQuery.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxWidth().padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                if (loadTimedOut) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("⚠️", fontSize = 32.sp)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Could not load stock data",
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            "Check your connection and organisation settings",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = {
                            loadTimedOut = false
                            viewModel.refreshStocks()
                        }) {
                            Text("Retry")
                        }
                    }
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(modifier = Modifier.height(16.dp))
                        Text("Loading stock data from Firebase...")
                    }
                }
            }
        }
        
        // No results message
        if (hasSearched && !isLoading && searchResults.size == 0 && searchQuery.length >= 2) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "❌",
                        fontSize = 32.sp
                    )
                    Text(
                        text = "No items found",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = "\"$searchQuery\" is not available in stock",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
            }
        }
        
        // Items list - Interactive tiles for Stock In
        LazyColumn {
            items(searchResults) { item ->
                StockInCard(
                    item = item,
                    onAddStock = { 
                        selectedItem = item
                        showDialog = true
                    }
                )
            }
        }
    }
    
    // Add quantity dialog
    if (showDialog && selectedItem != null) {
        AddQuantityDialog(
            item = selectedItem!!,
            viewModel = viewModel,
            onDismiss = { showDialog = false },
            onConfirm = { quantity ->
                // Handle stock addition with Firebase
                showDialog = false
                // Clear search after successful operation
                searchQuery = ""
                searchResults = emptyList()
                hasSearched = false
            }
        )
    }
}

@Composable
fun StockInCard(
    item: InventoryItem,
    onAddStock: () -> Unit
) {
    val stockStatus = when {
        item.quantityAvailable == 0 -> "OUT OF STOCK"
        item.quantityAvailable <= 5 -> "LOW STOCK"
        else -> "IN STOCK"
    }
    
    val statusColor = when {
        item.quantityAvailable == 0 -> MaterialTheme.colorScheme.error
        item.quantityAvailable <= 5 -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.primary
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clickable { onAddStock() },
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.name,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    Text(
                        text = "SKU: ${item.sku}",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = "${item.quantityAvailable} ${item.unit ?: "pcs"}",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = statusColor
                        )
                        
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = statusColor.copy(alpha = 0.1f)
                            )
                        ) {
                            Text(
                                text = stockStatus,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = statusColor,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                }
                
                // Add Stock Button
                Button(
                    onClick = onAddStock,
                    modifier = Modifier.padding(start = 8.dp)
                ) {
                    Text("📥 Add Stock")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddQuantityDialog(
    item: InventoryItem,
    viewModel: StockViewModel,
    onDismiss: () -> Unit,
    onConfirm: (Int) -> Unit
) {
    var quantity by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf("") }
    var showConfirmation by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }
    var selectedReason by remember { mutableStateOf("Amendment") }
    var customReason by remember { mutableStateOf("") }
    var showCustomInput by remember { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()
    
    val reasonOptions = listOf("Amendment", "Goods Receiving", "Other (specify)")
    
    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Column(
                modifier = Modifier.padding(20.dp)
            ) {
                Text(
                    text = "Add Stock",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    modifier = Modifier.padding(bottom = 16.dp)
                )
                
                Text(
                    text = item.name,
                    fontSize = 16.sp,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                
                Text(
                    text = "Current Stock: ${item.quantityAvailable} ${item.unit ?: "pcs"}",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 16.dp)
                )
                
                OutlinedTextField(
                    value = quantity,
                    onValueChange = { 
                        quantity = it
                        errorMessage = ""
                    },
                    label = { Text("Quantity to Add") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp),
                    isError = errorMessage.isNotEmpty()
                )
                
                // Reason dropdown
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = !expanded },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp)
                ) {
                    OutlinedTextField(
                        value = selectedReason,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Reason") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        modifier = Modifier
                            .menuAnchor()
                            .fillMaxWidth()
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        reasonOptions.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option) },
                                onClick = {
                                    selectedReason = option
                                    showCustomInput = option == "Other (specify)"
                                    expanded = false
                                },
                                contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding
                            )
                        }
                    }
                }
                
                // Custom reason input (shown when "Other" is selected)
                if (showCustomInput) {
                    OutlinedTextField(
                        value = customReason,
                        onValueChange = { customReason = it },
                        label = { Text("Specify Reason") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 16.dp),
                        placeholder = { Text("Enter custom reason...") }
                    )
                }
                
                if (errorMessage.isNotEmpty()) {
                    Text(
                        text = errorMessage,
                        color = MaterialTheme.colorScheme.error,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(
                        onClick = onDismiss,
                        enabled = !isLoading
                    ) {
                        Text("Cancel")
                    }
                    
                    Spacer(modifier = Modifier.width(8.dp))
                    
                    Button(
                        onClick = {
                            val qty = quantity.toIntOrNull()
                            if (qty == null || qty <= 0) {
                                errorMessage = "Please enter a valid quantity"
                                return@Button
                            }
                            showConfirmation = true
                        },
                        enabled = !isLoading
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("Add Stock")
                        }
                    }
                }
            }
        }
    }
    
    // Confirmation dialog
    if (showConfirmation) {
        val qty = quantity.toIntOrNull() ?: 0
        AlertDialog(
            onDismissRequest = { showConfirmation = false },
            title = { Text("Confirm Stock Addition") },
            text = { 
                Text("Add $qty units to ${item.name}?\n\nCurrent: ${item.quantityAvailable} → New: ${item.quantityAvailable + qty}")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showConfirmation = false
                        isLoading = true
                        coroutineScope.launch {
                            try {
                                val finalReason = if (showCustomInput && customReason.isNotBlank()) {
                                    customReason
                                } else {
                                    selectedReason
                                }
                                viewModel.submitStockIn(
                                    stockId = item.itemId,
                                    quantity = qty,
                                    reason = "Stock In: $finalReason - Added $qty units"
                                )
                                onConfirm(qty)
                            } catch (e: Exception) {
                                errorMessage = "Failed to add stock: ${e.message}"
                            } finally {
                                isLoading = false
                            }
                        }
                    }
                ) {
                    Text("Confirm")
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmation = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}
