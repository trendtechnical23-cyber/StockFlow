package com.trendstock.trendmobility

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.trendstock.trendmobility.auth.AuthManager
import com.trendstock.trendmobility.screens.HomeScreen
import com.trendstock.trendmobility.screens.LoginScreen
import com.trendstock.trendmobility.services.FCMTokenManager
import com.trendstock.trendmobility.services.NotificationService
import com.trendstock.trendmobility.services.RealTimeNotificationService
import com.trendstock.trendmobility.utils.OrganizationManager
import com.stockflow.inventory.RealtimeActivityService

class MainActivity : ComponentActivity() {

    private lateinit var notificationService:       RealTimeNotificationService
    private lateinit var systemNotificationService: NotificationService
    private lateinit var realtimeActivityService:   RealtimeActivityService

    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
            if (isGranted)
                android.util.Log.d("MainActivity", "🔔 Notification permission granted")
            else
                android.util.Log.w("MainActivity", "🔕 Notification permission denied")
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Initialise auth manager (must be first)
        AuthManager.init(this)

        // Initialise organisation manager
        OrganizationManager.initialize(this)

        // Notification services
        notificationService       = RealTimeNotificationService.getInstance(this)
        systemNotificationService = NotificationService.getInstance(this)
        realtimeActivityService   = RealtimeActivityService.getInstance(this)

        handleNotificationIntent(intent)
        maybeRequestNotificationPermission()

        setContent {
            val isDarkTheme = isSystemInDarkTheme()
            MaterialTheme(
                colorScheme = if (isDarkTheme) darkColorScheme() else lightColorScheme()
            ) {
                var isLoggedIn by remember { mutableStateOf(AuthManager.isLoggedIn()) }

                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    if (isLoggedIn) {
                        HomeScreen(
                            modifier = Modifier.padding(innerPadding),
                            onLogout = {
                                // Clear FCM token before logout
                                FCMTokenManager.getInstance(this@MainActivity).clearToken()
                                // Clear Supabase session
                                AuthManager.clearSession()
                                isLoggedIn = false
                            }
                        )
                    } else {
                        LoginScreen(
                            modifier       = Modifier.padding(innerPadding),
                            onLoginSuccess = { isLoggedIn = true },
                        )
                    }
                }
            }
        }
    }

    private fun handleNotificationIntent(intent: Intent?) {
        intent?.extras?.let { extras ->
            val type     = extras.getString("type")
            val itemName = extras.getString("item_name")
            android.util.Log.d("FCM_INTENT", "Opened via notification: type=$type, item=$itemName")
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleNotificationIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        if (!AuthManager.isLoggedIn()) return

        maybeRequestNotificationPermission()
        notificationService.startListening()

        val orgId  = OrganizationManager.getCurrentOrganizationId()
        val userId = AuthManager.getUserId()

        if (orgId != null && userId != null) {
            android.util.Log.d("MainActivity", "▶ Starting realtime activity listener for org: $orgId")
            realtimeActivityService.startActivityListener(orgId, userId)
            realtimeActivityService.addActivityCallback { activity ->
                android.util.Log.d("MainActivity", "🖥 Dashboard activity: ${activity.action}")
            }
        }
    }

    override fun onStop() {
        super.onStop()
        notificationService.stopListening()
        realtimeActivityService.stopActivityListener()
    }

    override fun onDestroy() {
        super.onDestroy()
        realtimeActivityService.cleanup()
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val perm = Manifest.permission.POST_NOTIFICATIONS
            when {
                ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED -> Unit
                shouldShowRequestPermissionRationale(perm) -> requestPermissionLauncher.launch(perm)
                else -> requestPermissionLauncher.launch(perm)
            }
        }
    }

    @Suppress("unused")
    private fun openNotificationSettings() {
        startActivity(Intent().apply {
            action = Settings.ACTION_APP_NOTIFICATION_SETTINGS
            putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        })
    }
}
