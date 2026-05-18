package com.trendstock.trendmobility.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.lifecycle.viewmodel.compose.viewModel
import com.trendstock.trendmobility.viewmodels.InventoryViewModel
import androidx.navigation.compose.rememberNavController
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import com.trendstock.trendmobility.services.NotificationService
import com.trendstock.trendmobility.services.RealTimeNotificationService
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Brush
import kotlinx.coroutines.launch




@Composable
fun NavigationMenuItem(
    icon: String,
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .clickable { onClick() },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.Start,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = icon,
                fontSize = 20.sp,
                modifier = Modifier.padding(end = 12.dp)
            )
            Text(
                text = title,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    modifier: Modifier = Modifier,
    onLogout: () -> Unit
) {
    val navController = rememberNavController()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val viewModel: InventoryViewModel = viewModel()
    val context = LocalContext.current
    
    // Setup real-time sync on first composition
    LaunchedEffect(Unit) {
        viewModel.setupRealtimeSync()
        // Do initial refresh on app start
        viewModel.refreshInventory(forceRefresh = false)
    }
    
    // Cleanup on disposal
    DisposableEffect(Unit) {
        onDispose {
            viewModel.stopRealtimeSync()
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            SideMenuContent(
                onLogout = onLogout,
                onCloseDrawer = {
                    scope.launch {
                        drawerState.close()
                    }
                },
                onNavigate = { route -> navController.navigate(route) },
                onRefreshInventory = {
                    viewModel.refreshInventory(forceRefresh = true)
                    // Show toast to user
                    android.widget.Toast.makeText(
                        context,
                        "🔄 Refreshing inventory...",
                        android.widget.Toast.LENGTH_SHORT
                    ).show()
                }
            )
        }
    ) {
        NavHost(
            navController = navController,
            startDestination = "main_menu",
            enterTransition = { EnterTransition.None },
            exitTransition = { ExitTransition.None },
            popEnterTransition = { EnterTransition.None },
            popExitTransition = { ExitTransition.None }
        ) {
            composable("main_menu") {
                MainMenuScreen(
                    modifier = modifier,
                    drawerState = drawerState,
                    onNavigate = { route -> navController.navigate(route) }
                )
            }
            composable("stock_in") {
                StockInScreen(
                    onBack = { navController.popBackStack() }
                )
            }
            composable("stock_out") {
                StockOutScreen(
                    onBack = { navController.popBackStack() }
                )
            }
            composable("stock_take") {
                StockTakeScreenNew(
                    onBack = { navController.popBackStack() }
                )
            }
            composable("stock_check") {
                StockCheckScreen(
                    onBack = { navController.popBackStack() }
                )
            }
            composable("settings") {
                SettingsScreen(
                    onBack = { navController.popBackStack() }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainMenuScreen(
    modifier: Modifier = Modifier,
    drawerState: DrawerState,
    onNavigate: (String) -> Unit
) {
    val scope = rememberCoroutineScope()

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Header with hamburger menu
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = {
                    scope.launch {
                        drawerState.open()
                    }
                }
            ) {
                Icon(
                    imageVector = Icons.Default.Menu,
                    contentDescription = "Menu"
                )
            }

            Column(
                horizontalAlignment = Alignment.End
            ) {
                Text(
                    text = "📊 StockFlow",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Stock Management",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // Activity buttons
        val activities = listOf(
            Triple("Stock In", "📥", "stock_in"),
            Triple("Stock Out", "📤", "stock_out"),
            Triple("Stock Take", "📋", "stock_take"),
            Triple("Stock Check", "🔍", "stock_check")
        )

        activities.forEach { (title, icon, route) ->
            Card(
                onClick = { onNavigate(route) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(80.dp),
                shape = RoundedCornerShape(12.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = icon,
                        fontSize = 32.sp,
                        modifier = Modifier.padding(end = 16.dp)
                    )
                    Text(
                        text = title,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
    }
}

@Composable
fun SideMenuContent(
    onLogout: () -> Unit,
    onCloseDrawer: () -> Unit,
    onNavigate: (String) -> Unit,
    onRefreshInventory: () -> Unit = {}
) {
    val context = LocalContext.current
    val notificationService = NotificationService.getInstance(context)
    val realtimeService = RealTimeNotificationService.getInstance(context)

    var showSettingsDialog by remember { mutableStateOf(false) }
    var showAboutDialog by remember { mutableStateOf(false) }
    var notificationsEnabled by remember { mutableStateOf(notificationService.areNotificationsEnabled()) }

    ModalDrawerSheet(
        modifier = Modifier.fillMaxHeight()
    ) {
        Column(
            modifier = Modifier.fillMaxHeight()
        ) {
            // Purple gradient header
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp)
                    .background(
                        brush = androidx.compose.ui.graphics.Brush.horizontalGradient(
                            colors = listOf(
                                androidx.compose.ui.graphics.Color(0xFF6366F1),
                                androidx.compose.ui.graphics.Color(0xFF8B5CF6)
                            )
                        )
                    )
                    .padding(16.dp)
            ) {
                Column(
                    modifier = Modifier.align(Alignment.BottomStart)
                ) {
                    Text(
                        text = "📊",
                        fontSize = 32.sp
                    )
                    Text(
                        text = "StockFlow",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = androidx.compose.ui.graphics.Color.White
                    )
                    Text(
                        text = "Navigation Menu",
                        fontSize = 14.sp,
                        color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.8f)
                    )
                }
            }

            // Menu items
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp)
            ) {

                // Refresh Inventory
                NavigationMenuItem(
                    icon = "🔄",
                    title = "Refresh Inventory",
                    onClick = {
                        onRefreshInventory()
                        onCloseDrawer()
                    }
                )

                // Navigation Items
                NavigationMenuItem(
                    icon = "⚙️",
                    title = "Settings",
                    onClick = {
                        onNavigate("settings")
                        onCloseDrawer()
                    }
                )

                NavigationMenuItem(
                    icon = "",
                    title = "Test Notifications",
                    onClick = {
                        realtimeService.sendTestNotification()
                        onCloseDrawer()
                    }
                )

                NavigationMenuItem(
                    icon = "ℹ️",
                    title = "About",
                    onClick = {
                        showAboutDialog = true
                        onCloseDrawer()
                    }
                )
            }

            Spacer(modifier = Modifier.weight(1f))

            // Logout button at bottom
            HorizontalDivider(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                thickness = 1.dp,
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f)
            )

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp)
                    .clickable {
                        onCloseDrawer()
                        onLogout()
                    },
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.Start,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "🚪",
                        fontSize = 20.sp,
                        modifier = Modifier.padding(end = 12.dp)
                    )
                    Text(
                        text = "Logout",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onErrorContainer
                    )
                }
            }
        }
    }

    // Settings Dialog
    if (showSettingsDialog) {
        AlertDialog(
            onDismissRequest = { showSettingsDialog = false },
            title = { Text("⚙️ Settings") },
            text = {
                Column {
                    Text("App Version: 1.0.0")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Firebase: Connected")
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Notifications: ")
                        Switch(
                            checked = notificationsEnabled,
                            onCheckedChange = { notificationsEnabled = it }
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSettingsDialog = false }) {
                    Text("OK")
                }
            }
        )
    }

    // About Dialog
    if (showAboutDialog) {
        AlertDialog(
            onDismissRequest = { showAboutDialog = false },
            title = { Text("ℹ️ About StockFlow") },
            text = {
                Column {
                    Text("📊 StockFlow Stock Management")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Version: 1.0.0")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Real-time Firebase Integration")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Features:")
                    Text("• Stock In/Out Operations")
                    Text("• Stock Take & Counting")
                    Text("• Real-time Search")
                    Text("• Mobile Scanner Support")
                }
            },
            confirmButton = {
                TextButton(onClick = { showAboutDialog = false }) {
                    Text("Close")
                }
            }
        )
    }
}
