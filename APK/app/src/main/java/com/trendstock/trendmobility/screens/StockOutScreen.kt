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
fun StockOutScreen(
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
    
    // Observe all stocks from Firebase
    val allStocks: List<InventoryItem> by viewModel.stocks.observeAsState(emptyList())
    
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
                Icon(
                    imageVector = Icons.Default.ArrowBack,
                    contentDescription = "Back"
                )
            }
            Text(
                text = "📤 Stock Out",
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
            label = { Text("Search items to remove stock...") },
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
        
        // Empty state
        if (hasSearched && searchResults.isEmpty() && !isLoading) {
            if (searchQuery.length >= 2) {
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
        
        // Items list - Interactive tiles for Stock Out
        LazyColumn {
            items(searchResults) { item ->
                StockOutCard(
                    item = item,
                    onRemoveStock = { 
                        selectedItem = item
                        showDialog = true
                    }
                )
            }
        }
    }
    
    // Stock removal dialog
    if (showDialog && selectedItem != null) {
        RemoveQuantityDialog(
            item = selectedItem!!,
            viewModel = viewModel,
            onDismiss = { showDialog = false },
            onConfirm = { removedQuantity ->
                // Handle stock removal with Firebase
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
fun StockOutCard(
    item: InventoryItem,
    onRemoveStock: () -> Unit
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
            .clickable { onRemoveStock() },
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
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
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
                
                // Remove Stock Button
                Button(
                    onClick = onRemoveStock,
                    modifier = Modifier.padding(start = 8.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    ),
                    enabled = item.quantityAvailable > 0
                ) {
                    Text("📤 Remove")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoveQuantityDialog(
    item: InventoryItem,
    viewModel: StockViewModel,
    onDismiss: () -> Unit,
    onConfirm: (Int) -> Unit
) {
    var quantityToRemove by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf("") }
    var showConfirmation by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }
    var selectedReason by remember { mutableStateOf("Repair") }
    var customReason by remember { mutableStateOf("") }
    var showCustomInput by remember { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()
    
    val reasonOptions = listOf("Repair", "Amendment", "Other (specify)")
    
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
                    text = "Remove Stock",
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
                    text = "Available: ${item.quantityAvailable} ${item.unit ?: "pcs"}",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 16.dp)
                )
                
                OutlinedTextField(
                    value = quantityToRemove,
                    onValueChange = { 
                        quantityToRemove = it
                        errorMessage = ""
                    },
                    label = { Text("Quantity to remove") },
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
                            val qty = quantityToRemove.toIntOrNull()
                            if (qty == null || qty <= 0) {
                                errorMessage = "Please enter a valid quantity"
                                return@Button
                            }
                            if (qty > item.quantityAvailable) {
                                errorMessage = "Cannot remove more than available (${item.quantityAvailable})"
                                return@Button
                            }
                            showConfirmation = true
                        },
                        enabled = !isLoading,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        if (isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("Remove Stock")
                        }
                    }
                }
            }
        }
    }
    
    // Confirmation dialog
    if (showConfirmation) {
        val qty = quantityToRemove.toIntOrNull() ?: 0
        AlertDialog(
            onDismissRequest = { showConfirmation = false },
            title = { Text("Confirm Stock Removal") },
            text = { 
                Text("Remove $qty units from ${item.name}?\n\nCurrent: ${item.quantityAvailable} → New: ${item.quantityAvailable - qty}")
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
                                viewModel.submitStockOut(
                                    stockId = item.itemId,
                                    quantity = qty,
                                    reason = "Stock Out: $finalReason - Removed $qty units"
                                )
                                onConfirm(qty)
                            } catch (e: Exception) {
                                errorMessage = "Failed to remove stock: ${e.message}"
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
