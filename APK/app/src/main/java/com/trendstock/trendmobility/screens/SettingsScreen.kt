package com.trendstock.trendmobility.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.trendstock.trendmobility.auth.AuthManager
import com.trendstock.trendmobility.services.FCMTokenManager
import com.trendstock.trendmobility.services.RealTimeNotificationService
import com.trendstock.trendmobility.utils.PreferencesManager
import kotlinx.coroutines.launch
import android.widget.Toast
import android.content.Context

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val fcmTokenManager = FCMTokenManager.getInstance(context)
    val prefsManager = remember { PreferencesManager.getInstance(context) }
    val scope = rememberCoroutineScope()
    // Auth and data now via AuthManager / Supabase — no Firebase Auth or Firestore
    
    // Load saved preferences
    var isDarkMode by remember { mutableStateOf(prefsManager.getBoolean("dark_mode", false)) }
    var notificationsEnabled by remember { mutableStateOf(prefsManager.getBoolean("notifications_enabled", true)) }
    var stockLowAlerts by remember { mutableStateOf(prefsManager.getBoolean("stock_low_alerts", true)) }
    var stockOutAlerts by remember { mutableStateOf(prefsManager.getBoolean("stock_out_alerts", true)) }
    var stockInNotifications by remember { mutableStateOf(prefsManager.getBoolean("stock_in_notifications", true)) }
    var activityUpdates by remember { mutableStateOf(prefsManager.getBoolean("activity_updates", true)) }
    var autoBackup by remember { mutableStateOf(prefsManager.getBoolean("auto_backup", true)) }
    var lowStockThreshold by remember { mutableStateOf(prefsManager.getString("low_stock_threshold", "10")) }
    var showConfirmationModal by remember { mutableStateOf(false) }
    var selectedAction by remember { mutableStateOf("") }
    var showPasswordDialog by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    
    Column(
        modifier = modifier
            .fillMaxSize()
            .statusBarsPadding()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF6A1B9A),
                        Color(0xFF8E24AA),
                        Color(0xFFAB47BC)
                    )
                )
            )
    ) {
        // Header with back button and title
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp, start = 16.dp, end = 16.dp, bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White.copy(alpha = 0.2f))
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = Color.White
                )
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Text(
                text = "Settings",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
        }
        
        // Settings content in white card
        Card(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
            colors = CardDefaults.cardColors(containerColor = Color.White),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                // App Preferences Section
                SettingsSection(title = "App Preferences") {
                    SettingsItem(
                        icon = "🌙",
                        title = "Dark Mode",
                        subtitle = if (isDarkMode) "Dark theme enabled (restart required)" else "Switch to dark theme",
                        trailing = {
                            Switch(
                                checked = isDarkMode,
                                onCheckedChange = { 
                                    isDarkMode = it
                                    prefsManager.saveBoolean("dark_mode", it)
                                    Toast.makeText(context, "Restart app to apply theme", Toast.LENGTH_SHORT).show()
                                }
                            )
                        }
                    )
                    
                    SettingsItem(
                        icon = "🔔",
                        title = "Push Notifications",
                        subtitle = "Enable all push notifications",
                        trailing = {
                            Switch(
                                checked = notificationsEnabled,
                                onCheckedChange = { 
                                    notificationsEnabled = it
                                    prefsManager.saveBoolean("notifications_enabled", it)
                                    // Update FCM notification settings
                                    updateNotificationSettings(
                                        fcmTokenManager = fcmTokenManager,
                                        notificationsEnabled = it,
                                        stockLowAlerts = stockLowAlerts,
                                        stockOutAlerts = stockOutAlerts,
                                        stockInNotifications = stockInNotifications,
                                        activityUpdates = activityUpdates
                                    )
                                    Toast.makeText(context, "Notifications ${if (it) "enabled" else "disabled"}", Toast.LENGTH_SHORT).show()
                                }
                            )
                        }
                    )
                    
                    if (notificationsEnabled) {
                        SettingsItem(
                            icon = "⚠️",
                            title = "Low Stock Alerts",
                            subtitle = "Notify when stock runs low",
                            trailing = {
                                Switch(
                                    checked = stockLowAlerts,
                                    onCheckedChange = { 
                                        stockLowAlerts = it
                                        prefsManager.saveBoolean("stock_low_alerts", it)
                                        updateNotificationSettings(
                                            fcmTokenManager = fcmTokenManager,
                                            notificationsEnabled = notificationsEnabled,
                                            stockLowAlerts = it,
                                            stockOutAlerts = stockOutAlerts,
                                            stockInNotifications = stockInNotifications,
                                            activityUpdates = activityUpdates
                                        )
                                    }
                                )
                            }
                        )
                        
                        SettingsItem(
                            icon = "🚨",
                            title = "Out of Stock Alerts",
                            subtitle = "Notify when items are out of stock",
                            trailing = {
                                Switch(
                                    checked = stockOutAlerts,
                                    onCheckedChange = { 
                                        stockOutAlerts = it
                                        prefsManager.saveBoolean("stock_out_alerts", it)
                                        updateNotificationSettings(
                                            fcmTokenManager = fcmTokenManager,
                                            notificationsEnabled = notificationsEnabled,
                                            stockLowAlerts = stockLowAlerts,
                                            stockOutAlerts = it,
                                            stockInNotifications = stockInNotifications,
                                            activityUpdates = activityUpdates
                                        )
                                    }
                                )
                            }
                        )
                        
                        SettingsItem(
                            icon = "📦",
                            title = "Stock In Notifications",
                            subtitle = "Notify when stock is added",
                            trailing = {
                                Switch(
                                    checked = stockInNotifications,
                                    onCheckedChange = { 
                                        stockInNotifications = it
                                        prefsManager.saveBoolean("stock_in_notifications", it)
                                        updateNotificationSettings(
                                            fcmTokenManager = fcmTokenManager,
                                            notificationsEnabled = notificationsEnabled,
                                            stockLowAlerts = stockLowAlerts,
                                            stockOutAlerts = stockOutAlerts,
                                            stockInNotifications = it,
                                            activityUpdates = activityUpdates
                                        )
                                    }
                                )
                            }
                        )
                        
                        SettingsItem(
                            icon = "📋",
                            title = "Activity Updates",
                            subtitle = "Notify on inventory activity",
                            trailing = {
                                Switch(
                                    checked = activityUpdates,
                                    onCheckedChange = { 
                                        activityUpdates = it
                                        prefsManager.saveBoolean("activity_updates", it)
                                        updateNotificationSettings(
                                            fcmTokenManager = fcmTokenManager,
                                            notificationsEnabled = notificationsEnabled,
                                            stockLowAlerts = stockLowAlerts,
                                            stockOutAlerts = stockOutAlerts,
                                            stockInNotifications = stockInNotifications,
                                            activityUpdates = it
                                        )
                                    }
                                )
                            }
                        )
                    }
                    
                    SettingsItem(
                        icon = "🔄",
                        title = "Auto Backup",
                        subtitle = if (autoBackup) "Daily backup enabled" else "Automatic data backup",
                        trailing = {
                            Switch(
                                checked = autoBackup,
                                onCheckedChange = { 
                                    autoBackup = it
                                    prefsManager.saveBoolean("auto_backup", it)
                                    Toast.makeText(context, "Auto backup ${if (it) "enabled" else "disabled"}", Toast.LENGTH_SHORT).show()
                                }
                            )
                        }
                    )
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                // Inventory Settings Section
                SettingsSection(title = "Inventory Settings") {
                    SettingsItem(
                        icon = "📊",
                        title = "Low Stock Threshold",
                        subtitle = "Alert when stock falls below $lowStockThreshold items",
                        trailing = {
                            OutlinedTextField(
                                value = lowStockThreshold,
                                onValueChange = { 
                                    if (it.all { char -> char.isDigit() } || it.isEmpty()) {
                                        lowStockThreshold = it
                                        if (it.isNotEmpty()) {
                                            prefsManager.saveString("low_stock_threshold", it)
                                        }
                                    }
                                },
                                modifier = Modifier.width(80.dp),
                                singleLine = true
                            )
                        }
                    )
                    
                    SettingsItem(
                        icon = "📈",
                        title = "Stock Reports",
                        subtitle = "View detailed inventory reports",
                        onClick = {
                            // Navigate to reports
                        }
                    )
                    
                    SettingsItem(
                        icon = "📂",
                        title = "Export Data",
                        subtitle = "Export inventory to CSV/Excel",
                        onClick = {
                            selectedAction = "export"
                            showConfirmationModal = true
                        }
                    )
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                // Account & Data Section
                SettingsSection(title = "Account & Data") {
                    SettingsItem(
                        icon = "👤",
                        title = "Account Info",
                        subtitle = "Manage your account details"
                    )
                    
                    SettingsItem(
                        icon = "🔐",
                        title = "Change Password",
                        subtitle = "Update your password",
                        onClick = {
                            selectedAction = "password"
                            showConfirmationModal = true
                        }
                    )
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                // Beta Testing Section
                SettingsSection(title = "🧪 Beta Testing / Development") {
                    SettingsItem(
                        icon = "🧹",
                        title = "Clear All Local Data",
                        subtitle = "Remove ALL cached data, preferences & storage (Fresh Start)",
                        onClick = {
                            selectedAction = "clear_all_local"
                            showConfirmationModal = true
                        },
                        isDestructive = true
                    )
                    
                    SettingsItem(
                        icon = "🗑️",
                        title = "Clear Cache Only",
                        subtitle = "Remove inventory cache (Keep settings)",
                        onClick = {
                            selectedAction = "clear_cache"
                            showConfirmationModal = true
                        },
                        isDestructive = false
                    )
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                // About Section
                SettingsSection(title = "About") {
                    SettingsItem(
                        icon = "ℹ️",
                        title = "App Version",
                        subtitle = "Version 1.0.0"
                    )
                    
                    SettingsItem(
                        icon = "📋",
                        title = "Terms of Service",
                        subtitle = "View terms and conditions"
                    )
                    
                    SettingsItem(
                        icon = "🔒",
                        title = "Privacy Policy",
                        subtitle = "How we handle your data"
                    )
                    
                    SettingsItem(
                        icon = "�",
                        title = "Test Notifications",
                        subtitle = "Send a test push notification",
                        onClick = {
                            RealTimeNotificationService.getInstance(context).sendTestNotification()
                        }
                    )
                    
                    SettingsItem(
                        icon = "�💬",
                        title = "Support",
                        subtitle = "Get help and contact support"
                    )
                }
            }
        }
    }
    
    // Confirmation Modal
    if (showConfirmationModal) {
        AlertDialog(
            onDismissRequest = { showConfirmationModal = false },
            title = {
                Text(
                    text = when (selectedAction) {
                        "export" -> "Export Data"
                        "password" -> "Change Password"
                        "clear_all_local" -> "⚠️ Clear ALL Local Data"
                        "clear_cache" -> "Clear Cache"
                        "clear_data" -> "Clear All Data"
                        else -> "Confirm Action"
                    }
                )
            },
            text = {
                Column {
                    Text(
                        text = when (selectedAction) {
                            "export" -> "Export all inventory data to Firebase backup?"
                            "password" -> "You will receive a password reset email."
                            "clear_all_local" -> "⚠️ BETA TESTING CLEANUP\\n\\nThis will delete:\\n• SQLite cache\\n• All SharedPreferences\\n• Saved settings\\n• Organization data\\n• FCM tokens\\n\\nYou'll need to LOGIN AGAIN after this.\\n\\n✅ Perfect for clean testing!"
                            "clear_cache" -> "This will clear inventory cache only. Your settings and login will be preserved."
                            "clear_data" -> "This will permanently delete all local inventory data. This action cannot be undone."
                            else -> "Are you sure you want to perform this action?"
                        }
                    )
                    if (isLoading) {
                        Spacer(modifier = Modifier.height(16.dp))
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        when (selectedAction) {
                            "export" -> {
                                showConfirmationModal = false
                                Toast.makeText(context, "Export is not supported in this version.", Toast.LENGTH_SHORT).show()
                            }
                            "password" -> {
                                showConfirmationModal = false
                                showPasswordDialog = true
                            }
                            "clear_all_local" -> {
                                isLoading = true
                                scope.launch {
                                    try {
                                        val result = com.trendstock.trendmobility.utils.DataCleaner.clearAllLocalData(context)
                                        isLoading = false
                                        showConfirmationModal = false
                                        if (result.isSuccess) {
                                            Toast.makeText(context, result.getOrNull() ?: "All data cleared", Toast.LENGTH_LONG).show()
                                        } else {
                                            Toast.makeText(context, "Cleanup failed: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                                        }
                                    } catch (e: Exception) {
                                        isLoading = false
                                        Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                            "clear_cache" -> {
                                isLoading = true
                                scope.launch {
                                    try {
                                        val result = com.trendstock.trendmobility.utils.DataCleaner.clearCacheOnly(context)
                                        isLoading = false
                                        showConfirmationModal = false
                                        if (result.isSuccess) {
                                            Toast.makeText(context, "Cache cleared successfully", Toast.LENGTH_SHORT).show()
                                        } else {
                                            Toast.makeText(context, "Failed: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                                        }
                                    } catch (e: Exception) {
                                        isLoading = false
                                        Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                            "clear_data" -> {
                                isLoading = true
                                scope.launch {
                                    try {
                                        clearAllData(context, prefsManager)
                                        isLoading = false
                                        showConfirmationModal = false
                                        Toast.makeText(context, "All data cleared", Toast.LENGTH_SHORT).show()
                                    } catch (e: Exception) {
                                        isLoading = false
                                        Toast.makeText(context, "Failed to clear data: ${e.message}", Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                        }
                    },
                    enabled = !isLoading,
                    colors = if (selectedAction == "clear_data") {
                        ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                    } else {
                        ButtonDefaults.buttonColors()
                    }
                ) {
                    Text(
                        text = when (selectedAction) {
                            "export" -> "Export"
                            "password" -> "Continue"
                            "clear_data" -> "Delete All"
                            else -> "Confirm"
                        }
                    )
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showConfirmationModal = false },
                    enabled = !isLoading
                ) {
                    Text("Cancel")
                }
            }
        )
    }
    
    // Password Reset Dialog
    if (showPasswordDialog) {
        var email by remember { mutableStateOf(AuthManager.getEmail() ?: "") }
        AlertDialog(
            onDismissRequest = { showPasswordDialog = false },
            title = { Text("Reset Password") },
            text = {
                Column {
                    Text("Enter your email to receive a password reset link:")
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("Email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    if (isLoading) {
                        Spacer(modifier = Modifier.height(16.dp))
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (email.isNotBlank()) {
                            isLoading = true
                            scope.launch {
                                val result = AuthManager.sendPasswordReset(email)
                                isLoading = false
                                showPasswordDialog = false
                                if (result.isSuccess) {
                                    Toast.makeText(context, "Password reset email sent to $email", Toast.LENGTH_LONG).show()
                                } else {
                                    Toast.makeText(context, "Failed: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                                }
                            }
                        } else {
                            Toast.makeText(context, "Please enter your email", Toast.LENGTH_SHORT).show()
                        }
                    },
                    enabled = !isLoading
                ) {
                    Text("Send Reset Email")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showPasswordDialog = false },
                    enabled = !isLoading
                ) {
                    Text("Cancel")
                }
            }
        )
    }
}

/**
 * Helper function to update notification settings in Firestore
 */
private fun updateNotificationSettings(
    fcmTokenManager: FCMTokenManager,
    notificationsEnabled: Boolean,
    stockLowAlerts: Boolean,
    stockOutAlerts: Boolean,
    stockInNotifications: Boolean,
    activityUpdates: Boolean
) {
    val settings = mapOf(
        "allNotifications" to notificationsEnabled,
        "stockLowAlerts" to (notificationsEnabled && stockLowAlerts),
        "stockOutAlerts" to (notificationsEnabled && stockOutAlerts),
        "stockInNotifications" to (notificationsEnabled && stockInNotifications),
        "activityUpdates" to (notificationsEnabled && activityUpdates),
        "systemNotifications" to notificationsEnabled
    )
    
    // Notification settings are saved locally via prefsManager — no Firestore write needed
    android.util.Log.d("SettingsScreen", "Notification settings updated locally")
}

@Composable
fun SettingsSection(
    title: String,
    content: @Composable () -> Unit
) {
    Column {
        Text(
            text = title,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
            color = Color(0xFF6A1B9A),
            modifier = Modifier.padding(bottom = 12.dp)
        )
        content()
    }
}

@Composable
fun SettingsItem(
    icon: String,
    title: String,
    subtitle: String? = null,
    trailing: @Composable (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    isDestructive: Boolean = false
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clickable(enabled = onClick != null) { onClick?.invoke() },
        colors = CardDefaults.cardColors(
            containerColor = if (isDestructive) {
                Color(0xFFFFEBEE)
            } else {
                MaterialTheme.colorScheme.surface
            }
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = icon,
                fontSize = 24.sp,
                modifier = Modifier.padding(end = 16.dp)
            )
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (isDestructive) Color(0xFFD32F2F) else MaterialTheme.colorScheme.onSurface
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        fontSize = 14.sp,
                        color = if (isDestructive) Color(0xFFD32F2F).copy(alpha = 0.7f) else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                    )
                }
            }
            
            trailing?.invoke()
        }
    }
}

// exportDataToFirebase removed — Firestore no longer in use.

/**
 * Clear all local data
 */
private fun clearAllData(context: Context, prefsManager: com.trendstock.trendmobility.utils.PreferencesManager) {
    // Clear SharedPreferences
    prefsManager.clearAll()
    
    // Clear cache
    context.cacheDir.deleteRecursively()
}

