package com.trendstock.trendmobility.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import com.trendstock.trendmobility.api.ApiClient
import com.trendstock.trendmobility.auth.AuthManager
import com.trendstock.trendmobility.services.FCMTokenManager
import com.trendstock.trendmobility.utils.OrganizationManager
import com.trendstock.trendmobility.utils.UserPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun LoginScreen(
    modifier: Modifier = Modifier,
    onLoginSuccess: () -> Unit,
) {
    val context  = LocalContext.current
    val userPrefs = UserPreferences.getInstance(context)

    var email        by remember { mutableStateOf(userPrefs.getLastEmail() ?: "") }
    var password     by remember { mutableStateOf("") }
    var isLoading    by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf("") }

    Box(modifier = modifier.fillMaxSize()) {

        // Gradient background
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color(0xFF6366F1),
                            Color(0xFF8B5CF6),
                            Color(0xFFA855F7),
                        )
                    )
                )
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement   = Arrangement.Center,
            horizontalAlignment   = Alignment.CenterHorizontally,
        ) {

            Text("📊", fontSize = 48.sp, modifier = Modifier.padding(bottom = 8.dp))
            Text(
                "StockFlow",
                fontSize   = 32.sp,
                fontWeight = FontWeight.Bold,
                color      = Color.White,
                modifier   = Modifier.padding(bottom = 8.dp),
            )
            Text(
                "Stock Management",
                fontSize = 16.sp,
                color    = Color.White.copy(alpha = 0.9f),
                modifier = Modifier.padding(bottom = 48.dp),
            )

            // ── Input card ────────────────────────────────────────────────────
            Card(
                modifier  = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                colors    = CardDefaults.cardColors(containerColor = Color.White),
                shape     = RoundedCornerShape(16.dp),
            ) {
                Column(
                    modifier  = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    OutlinedTextField(
                        value         = email,
                        onValueChange = { email = it; errorMessage = "" },
                        label         = { Text("Email") },
                        modifier      = Modifier.fillMaxWidth(),
                        enabled       = !isLoading,
                        singleLine    = true,
                    )
                    OutlinedTextField(
                        value               = password,
                        onValueChange       = { password = it; errorMessage = "" },
                        label               = { Text("Password") },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier            = Modifier.fillMaxWidth(),
                        enabled             = !isLoading,
                        singleLine          = true,
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            if (errorMessage.isNotEmpty()) {
                Text(
                    text      = errorMessage,
                    color     = MaterialTheme.colorScheme.error,
                    modifier  = Modifier.padding(bottom = 16.dp),
                    textAlign = TextAlign.Center,
                )
            }

            // ── Sign-in button ────────────────────────────────────────────────
            Button(
                onClick = {
                    if (email.isBlank() || password.isBlank()) {
                        errorMessage = "Please enter your email and password."
                        return@Button
                    }

                    isLoading    = true
                    errorMessage = ""

                    CoroutineScope(Dispatchers.IO).launch {
                        // 1. Supabase auth
                        val authResult = AuthManager.signIn(email.trim(), password)
                        if (authResult.isFailure) {
                            withContext(Dispatchers.Main) {
                                errorMessage = authResult.exceptionOrNull()?.message ?: "Login failed"
                                isLoading    = false
                            }
                            return@launch
                        }

                        // 2. Resolve org UUID from Railway backend
                        val authHeader = "Bearer ${AuthManager.getAccessTokenSync()}"
                        val orgResult  = runCatching {
                            ApiClient.mobileService.getUserOrg(authHeader)
                        }

                        val orgResponse = orgResult.getOrNull()
                        val orgId = orgResponse?.body()?.data?.orgId
                        if (orgId.isNullOrBlank()) {
                            val serverMsg = orgResponse?.body()?.message
                                ?: orgResult.exceptionOrNull()?.message
                                ?: "No organisation found for this account."
                            android.util.Log.e("LoginScreen", "user-org failed: HTTP ${orgResponse?.code()} — $serverMsg")
                            AuthManager.clearSession()
                            withContext(Dispatchers.Main) {
                                errorMessage = serverMsg
                                isLoading    = false
                            }
                            return@launch
                        }

                        // 3. Persist org + email
                        AuthManager.saveOrgId(orgId)
                        userPrefs.saveLastEmail(email.trim())

                        // 4. Handle organisation switch / set org in manager
                        val orgManager = OrganizationManager.getInstance()
                        val oldOrgId   = orgManager.getCurrentOrganizationId()
                        if (oldOrgId != orgId) {
                            orgManager.switchOrganization(orgId)
                        } else {
                            userPrefs.saveOrganizationId(orgId)
                        }

                        // 5. Register FCM token
                        FCMTokenManager.getInstance(context).initializeFCMToken()

                        // 6. Prime local Room cache
                        runCatching {
                            com.trendstock.trendmobility.database.InventoryRepository
                                .getInstance(context)
                                .refreshInventory(forceRefresh = true)
                        }

                        withContext(Dispatchers.Main) {
                            isLoading = false
                            onLoginSuccess()
                        }
                    }
                },
                modifier  = Modifier.fillMaxWidth().padding(horizontal = 8.dp).height(56.dp),
                enabled   = !isLoading,
                colors    = ButtonDefaults.buttonColors(
                    containerColor = Color.White,
                    contentColor   = Color(0xFF8B5CF6),
                ),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 4.dp),
                shape     = RoundedCornerShape(12.dp),
            ) {
                if (isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color    = Color(0xFF8B5CF6),
                    )
                } else {
                    Text("Sign In", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
