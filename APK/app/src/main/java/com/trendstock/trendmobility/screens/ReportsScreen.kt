package com.trendstock.trendmobility.screens

import androidx.compose.foundation.background
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    var selectedReportType by remember { mutableStateOf("inventory") }
    var selectedPeriod by remember { mutableStateOf("weekly") }
    
    Column(
        modifier = modifier
            .fillMaxSize()
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
                .padding(16.dp),
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
                text = "Reports",
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
        }
        
        // Reports content in white card
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
                // Report Type Selection
                Text(
                    text = "Report Type",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF6A1B9A),
                    modifier = Modifier.padding(bottom = 12.dp)
                )
                
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    ReportTypeChip(
                        text = "Inventory",
                        isSelected = selectedReportType == "inventory",
                        onClick = { selectedReportType = "inventory" },
                        modifier = Modifier.weight(1f)
                    )
                    ReportTypeChip(
                        text = "Stock Flow",
                        isSelected = selectedReportType == "flow",
                        onClick = { selectedReportType = "flow" },
                        modifier = Modifier.weight(1f)
                    )
                    ReportTypeChip(
                        text = "Analytics",
                        isSelected = selectedReportType == "analytics",
                        onClick = { selectedReportType = "analytics" },
                        modifier = Modifier.weight(1f)
                    )
                }
                
                Spacer(modifier = Modifier.height(16.dp))
                
                // Time Period Selection
                Text(
                    text = "Time Period",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF6A1B9A),
                    modifier = Modifier.padding(bottom = 12.dp)
                )
                
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    ReportTypeChip(
                        text = "Daily",
                        isSelected = selectedPeriod == "daily",
                        onClick = { selectedPeriod = "daily" },
                        modifier = Modifier.weight(1f)
                    )
                    ReportTypeChip(
                        text = "Weekly",
                        isSelected = selectedPeriod == "weekly",
                        onClick = { selectedPeriod = "weekly" },
                        modifier = Modifier.weight(1f)
                    )
                    ReportTypeChip(
                        text = "Monthly",
                        isSelected = selectedPeriod == "monthly",
                        onClick = { selectedPeriod = "monthly" },
                        modifier = Modifier.weight(1f)
                    )
                }
                
                // Report Content based on selection
                when (selectedReportType) {
                    "inventory" -> InventoryReportContent(period = selectedPeriod)
                    "flow" -> StockFlowReportContent(period = selectedPeriod)
                    "analytics" -> AnalyticsReportContent(period = selectedPeriod)
                }
                
                Spacer(modifier = Modifier.height(24.dp))
                
                // Action Buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Button(
                        onClick = { /* Generate report */ },
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF6A1B9A)
                        )
                    ) {
                        Text("📊 Generate Report")
                    }
                    
                    OutlinedButton(
                        onClick = { /* Export report */ },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("📤 Export")
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportTypeChip(
    text: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    FilterChip(
        selected = isSelected,
        onClick = onClick,
        label = {
            Text(
                text = text,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        },
        modifier = modifier,
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = Color(0xFF6A1B9A),
            selectedLabelColor = Color.White
        )
    )
}

@Composable
fun InventoryReportContent(period: String) {
    Column {
        ReportCard(
            title = "Current Inventory Status",
            content = {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    ReportMetric(label = "Total Items", value = "247")
                    ReportMetric(label = "Low Stock", value = "12")
                    ReportMetric(label = "Out of Stock", value = "3")
                }
            }
        )
        
        Spacer(modifier = Modifier.height(12.dp))
        
        ReportCard(
            title = "Top Products ($period)",
            content = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TopProductItem(name = "Product A", quantity = 150)
                    TopProductItem(name = "Product B", quantity = 120)
                    TopProductItem(name = "Product C", quantity = 95)
                }
            }
        )
        
        Spacer(modifier = Modifier.height(12.dp))
        
        ReportCard(
            title = "Inventory Value",
            content = {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    ReportMetric(label = "Total Value", value = "$45,230")
                    ReportMetric(label = "Average Value", value = "$183")
                }
            }
        )
    }
}

@Composable
fun StockFlowReportContent(period: String) {
    Column {
        ReportCard(
            title = "Stock Movement ($period)",
            content = {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    ReportMetric(label = "Stock In", value = "1,234")
                    ReportMetric(label = "Stock Out", value = "987")
                    ReportMetric(label = "Net Change", value = "+247")
                }
            }
        )
        
        Spacer(modifier = Modifier.height(12.dp))
        
        ReportCard(
            title = "Most Active Items",
            content = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActiveItemRow(name = "Product X", inCount = 45, outCount = 38)
                    ActiveItemRow(name = "Product Y", inCount = 32, outCount = 29)
                    ActiveItemRow(name = "Product Z", inCount = 28, outCount = 31)
                }
            }
        )
    }
}

@Composable
fun AnalyticsReportContent(period: String) {
    Column {
        ReportCard(
            title = "Performance Metrics ($period)",
            content = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        ReportMetric(label = "Turnover Rate", value = "85%")
                        ReportMetric(label = "Accuracy Rate", value = "98.5%")
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        ReportMetric(label = "Avg. Processing Time", value = "2.3 min")
                        ReportMetric(label = "Error Rate", value = "0.8%")
                    }
                }
            }
        )
        
        Spacer(modifier = Modifier.height(12.dp))
        
        ReportCard(
            title = "Trends & Insights",
            content = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TrendItem(label = "Inventory Growth", trend = "+12%", isPositive = true)
                    TrendItem(label = "Stock Efficiency", trend = "+5%", isPositive = true)
                    TrendItem(label = "Waste Reduction", trend = "-8%", isPositive = true)
                }
            }
        )
    }
}

@Composable
fun ReportCard(
    title: String,
    content: @Composable () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = title,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF6A1B9A),
                modifier = Modifier.padding(bottom = 12.dp)
            )
            content()
        }
    }
}

@Composable
fun ReportMetric(
    label: String,
    value: String
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = value,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = label,
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
        )
    }
}

@Composable
fun TopProductItem(
    name: String,
    quantity: Int
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = name,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium
        )
        Text(
            text = "$quantity units",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
        )
    }
}

@Composable
fun ActiveItemRow(
    name: String,
    inCount: Int,
    outCount: Int
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = name,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = "In: $inCount",
            fontSize = 12.sp,
            color = Color(0xFF4CAF50)
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = "Out: $outCount",
            fontSize = 12.sp,
            color = Color(0xFFFF9800)
        )
    }
}

@Composable
fun TrendItem(
    label: String,
    trend: String,
    isPositive: Boolean
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium
        )
        Text(
            text = trend,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (isPositive) Color(0xFF4CAF50) else Color(0xFFFF5722)
        )
    }
}