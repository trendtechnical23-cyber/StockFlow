package com.trendstock.trendmobility

import android.content.Intent
import android.os.Bundle
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth
import com.trendstock.trendmobility.screens.LoginScreen
import com.trendstock.trendmobility.screens.HomeScreen
import com.trendstock.trendmobility.services.RealTimeNotificationService
import com.trendstock.trendmobility.services.NotificationService
import com.trendstock.trendmobility.services.FCMTokenManager
import com.stockflow.inventory.RealtimeActivityService
import com.google.firebase.firestore.FirebaseFirestore

class MainActivity : ComponentActivity() {
    private lateinit var auth: FirebaseAuth
    private lateinit var notificationService: RealTimeNotificationService
    private lateinit var systemNotificationService: NotificationService
    private lateinit var realtimeActivityService: RealtimeActivityService
    
    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted: Boolean ->
            if (isGranted) {
                android.util.Log.d("MainActivity", "🔔 Notification permission granted")
            } else {
                android.util.Log.w("MainActivity", "🔕 Notification permission denied")
                // Optionally direct user to settings if they want to enable later
            }
        }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        
        auth = FirebaseAuth.getInstance()
        
        // Initialize organization manager
        com.trendstock.trendmobility.utils.OrganizationManager.initialize(this)
        
        // Initialize notification services
        notificationService = RealTimeNotificationService.getInstance(this)
        systemNotificationService = NotificationService.getInstance(this)
        
        // Initialize real-time activity service
        realtimeActivityService = RealtimeActivityService.getInstance(this, FirebaseFirestore.getInstance())
        
        // Handle notification data when app is opened from notification
        handleNotificationIntent(intent)
        
    // Proactively request notification permission on Android 13+
    maybeRequestNotificationPermission()
        
        setContent {
            val isDarkTheme = isSystemInDarkTheme()
            
            MaterialTheme(
                colorScheme = if (isDarkTheme) darkColorScheme() else lightColorScheme()
            ) {
                var isLoggedIn by remember { mutableStateOf(false) }
                
                LaunchedEffect(Unit) {
                    isLoggedIn = auth.currentUser != null
                }
                
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    if (isLoggedIn) {
                        HomeScreen(
                            modifier = Modifier.padding(innerPadding),
                            onLogout = {
                                // Clear FCM token before logout
                                val fcmTokenManager = FCMTokenManager.getInstance(this@MainActivity)
                                fcmTokenManager.clearToken()
                                
                                // Sign out from Firebase
                                auth.signOut()
                                isLoggedIn = false
                            }
                        )
                    } else {
                        LoginScreen(
                            modifier = Modifier.padding(innerPadding),
                            onLoginSuccess = { isLoggedIn = true }
                        )
                    }
                }
            }
        }
    }
    
    /**
     * Handle notification intent when app is opened from notification
     */
    private fun handleNotificationIntent(intent: Intent?) {
        intent?.extras?.let { extras ->
            val notificationType = extras.getString("type")
            val itemName = extras.getString("item_name")
            val title = extras.getString("title")
            val body = extras.getString("body")
            
            // Log notification data for debugging
            android.util.Log.d("FCM_INTENT", "Notification opened: type=$notificationType, item=$itemName, title=$title")
            
            // You can handle different notification types here
            // For example, navigate to specific screens based on notification type
        }
    }
    
    /**
     * Handle new intents when app is already running
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleNotificationIntent(intent)
    }
    
    override fun onStart() {
        super.onStart()
        // Start listening for notifications when app starts
        if (auth.currentUser != null) {
            // Ensure we still have notification permission
            maybeRequestNotificationPermission()
            
            notificationService.startListening()
            
            // Start real-time activity listener
            val user = auth.currentUser
            val orgManager = com.trendstock.trendmobility.utils.OrganizationManager.getInstance()
            val orgId = orgManager.getCurrentOrganizationId()
            
            if (user != null && orgId != null) {
                android.util.Log.d("MainActivity", "🔥 Starting real-time activity listener for org: $orgId")
                realtimeActivityService.startActivityListener(orgId, user.uid)
                
                // Add callback to update in-app UI for dashboard activities
                // NOTE: Do NOT show local notifications here — the server sends FCM
                // push notifications already. Showing local notifications would cause
                // duplicates.
                realtimeActivityService.addActivityCallback { activity ->
                    android.util.Log.d("MainActivity", "🖥️ Dashboard activity received: ${activity.action}")
                }
            }
        }
    }
    
    override fun onStop() {
        super.onStop()
        // Stop listening when app goes to background
        notificationService.stopListening()
        realtimeActivityService.stopActivityListener()
    }
    
    override fun onDestroy() {
        super.onDestroy()
        // Cleanup real-time activity service
        realtimeActivityService.cleanup()
    }
    
    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val permission = Manifest.permission.POST_NOTIFICATIONS
            when {
                ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED -> {
                    // Already granted
                }
                shouldShowRequestPermissionRationale(permission) -> {
                    // You could show UI explaining why you need this; request again
                    requestPermissionLauncher.launch(permission)
                }
                else -> {
                    // First-time ask
                    requestPermissionLauncher.launch(permission)
                }
            }
        }
    }
    
    @Suppress("unused")
    private fun openNotificationSettings() {
        val intent = Intent().apply {
            action = Settings.ACTION_APP_NOTIFICATION_SETTINGS
            putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        }
        startActivity(intent)
    }
}