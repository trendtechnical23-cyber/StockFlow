package com.trendstock.trendmobility.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseAuth
import com.trendstock.trendmobility.services.FCMTokenManager
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    modifier: Modifier = Modifier,
    onLoginSuccess: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val userPrefs = com.trendstock.trendmobility.utils.UserPreferences.getInstance(context)
    
    var email by remember { mutableStateOf(userPrefs.getLastEmail() ?: "") }
    var password by remember { mutableStateOf("") }
    // Do NOT pre-fill org ID — it causes users to accidentally concatenate IDs on re-login
    var organizationId by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf("") }
    var orgIdError by remember { mutableStateOf("") }
    
    val auth = FirebaseAuth.getInstance()
    
    Box(
        modifier = modifier.fillMaxSize()
    ) {
        // Purple gradient background
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    brush = androidx.compose.ui.graphics.Brush.verticalGradient(
                        colors = listOf(
                            androidx.compose.ui.graphics.Color(0xFF6366F1), // Indigo
                            androidx.compose.ui.graphics.Color(0xFF8B5CF6), // Purple
                            androidx.compose.ui.graphics.Color(0xFFA855F7)  // Purple-500
                        )
                    )
                )
        )
        
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
        // Logo and title section
        Text(
            text = "📊",
            fontSize = 48.sp,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        
        Text(
            text = "StockFlow",
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
            color = androidx.compose.ui.graphics.Color.White,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        
        Text(
            text = "Stock Management",
            fontSize = 16.sp,
            color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.9f),
            modifier = Modifier.padding(bottom = 48.dp)
        )
        
        // White card for input fields
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
            colors = CardDefaults.cardColors(
                containerColor = androidx.compose.ui.graphics.Color.White
            ),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Email field
                OutlinedTextField(
                    value = email,
                    onValueChange = { 
                        email = it
                        errorMessage = ""
                    },
                    label = { Text("Email") },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isLoading,
                    singleLine = true
                )
                
                // Password field
                OutlinedTextField(
                    value = password,
                    onValueChange = { 
                        password = it
                        errorMessage = ""
                    },
                    label = { Text("Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isLoading,
                    singleLine = true
                )
                
                // Organization ID field
                OutlinedTextField(
                    value = organizationId,
                    onValueChange = { 
                        organizationId = it.trim()
                        errorMessage = ""
                        // Detect concatenated org IDs before the user submits
                        val orgCount = Regex("org_").findAll(it).count()
                        orgIdError = when {
                            orgCount > 1 -> "Looks like multiple IDs are combined. Clear the field and paste only one org ID."
                            it.isNotEmpty() && !Regex("^org_[0-9]+_[a-zA-Z0-9]+$").matches(it.trim()) -> "Format: org_NUMBERS_LETTERS (e.g. org_1759748182815_wwid7nh0k)"
                            else -> ""
                        }
                    },
                    label = { Text("Organization ID") },
                    placeholder = { Text("e.g., org_1759748182815_wwid7nh0k") },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isLoading,
                    singleLine = true,
                    isError = orgIdError.isNotEmpty(),
                    supportingText = if (orgIdError.isNotEmpty()) {{
                        Text(orgIdError, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                    }} else null
                )
            }
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        
        // Error message
        if (errorMessage.isNotEmpty()) {
            Text(
                text = errorMessage,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(bottom = 16.dp),
                textAlign = TextAlign.Center
            )
        }
        
        // Login button
        Button(
            onClick = {
                if (email.isBlank() || password.isBlank() || organizationId.isBlank()) {
                    errorMessage = "Please enter email, password, and organization ID"
                    return@Button
                }

                // Reject obviously corrupted org IDs before hitting Firestore
                val orgCount = Regex("org_").findAll(organizationId).count()
                if (orgCount > 1) {
                    errorMessage = "Organization ID contains multiple IDs. Clear the field and enter just one."
                    return@Button
                }
                if (!Regex("^org_[0-9]+_[a-zA-Z0-9]+$").matches(organizationId)) {
                    errorMessage = "Invalid Organization ID format. Expected: org_NUMBERS_LETTERS"
                    return@Button
                }
                
                isLoading = true
                errorMessage = ""
                
                auth.signInWithEmailAndPassword(email, password)
                    .addOnCompleteListener { task ->
                        isLoading = false
                        if (task.isSuccessful) {
                            // FIX APK-ISSUE-#3: Use centralized organization switch handler
                            // This properly cleans up old organization data before switching
                            val orgManager = com.trendstock.trendmobility.utils.OrganizationManager.getInstance()
                            val oldOrgId = orgManager.getCurrentOrganizationId()
                            
                            // Save email for next login
                            userPrefs.saveLastEmail(email)
                            
                            // Switch organization (will clear old data if different)
                            if (oldOrgId != organizationId) {
                                android.util.Log.d("LoginScreen", "🔄 Organization switch detected: $oldOrgId → $organizationId")
                                orgManager.switchOrganization(organizationId)
                            } else {
                                // Same org, just update
                                userPrefs.saveOrganizationId(organizationId)
                            }
                            
                            // Initialize FCM token after successful login
                            val fcmTokenManager = FCMTokenManager.getInstance(context)
                            fcmTokenManager.initializeFCMToken()
                            
                            // Cache inventory items locally for offline stock take
                            CoroutineScope(Dispatchers.IO).launch {
                                try {
                                    cacheInventoryItemsLocally(context)
                                    android.util.Log.d("LoginScreen", "✅ Inventory cached successfully")
                                } catch (e: Exception) {
                                    android.util.Log.e("LoginScreen", "❌ Failed to cache inventory: ${e.message}")
                                }
                            }
                            
                            onLoginSuccess()
                        } else {
                            errorMessage = task.exception?.message ?: "Login failed"
                        }
                    }
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp)
                .height(56.dp),
            enabled = !isLoading,
            colors = ButtonDefaults.buttonColors(
                containerColor = androidx.compose.ui.graphics.Color.White,
                contentColor = androidx.compose.ui.graphics.Color(0xFF8B5CF6)
            ),
            elevation = ButtonDefaults.buttonElevation(defaultElevation = 4.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = androidx.compose.ui.graphics.Color(0xFF8B5CF6)
                )
            } else {
                Text(
                    text = "Sign In",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }
        }
        }
    }
}

// Helper function to cache inventory items locally for offline stock take
private suspend fun cacheInventoryItemsLocally(context: android.content.Context) {
    try {
        val database = com.google.firebase.database.FirebaseDatabase.getInstance().reference
        val snapshot = database.child("inventoryItems").get().await()
        
        val items = mutableListOf<com.trendstock.trendmobility.api.InventoryItem>()
        snapshot.children.forEach { child ->
            try {
                val item = child.getValue(com.trendstock.trendmobility.api.InventoryItem::class.java)
                if (item != null) {
                    items.add(item)
                }
            } catch (e: Exception) {
                android.util.Log.e("LoginScreen", "Error parsing item: ${e.message}")
            }
        }
        
        // Save to SharedPreferences
        val sharedPrefs = context.getSharedPreferences("OfflineInventory", android.content.Context.MODE_PRIVATE)
        val json = com.google.gson.Gson().toJson(items)
        sharedPrefs.edit().putString("cached_items", json).apply()
        sharedPrefs.edit().putLong("cache_timestamp", System.currentTimeMillis()).apply()
        
        android.util.Log.d("LoginScreen", "📦 Cached ${items.size} inventory items locally")
    } catch (e: Exception) {
        android.util.Log.e("LoginScreen", "❌ Failed to cache inventory: ${e.message}")
        throw e
    }
}
