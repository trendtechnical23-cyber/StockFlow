# 🐛 APK CRITICAL ISSUES - Analysis & Fixes

**Date:** March 1, 2026  
**Component:** Android APK (StockFlow Mobile)  
**Issues Identified:** 7 Critical Data Persistence & Synchronization Bugs  

---

## 🔴 CRITICAL ISSUES IDENTIFIED

### **ISSUE #1: Stock Take Sessions Persist Across Organizations** ⛔
**Severity:** 🔴 Critical  
**Impact:** Users see stock take data from deleted/previous organizations

**Root Cause:**
- Stock take session IDs stored in `StockFlowPrefs` SharedPreferences
- Keys: `activeStockTakeSessionId`, `activeStockTakeOrgId`  
- **Never cleared when user switches organizations**

**Files Affected:**
- `FirebaseService.kt` (line 92-94) - Reads session data
- `StockFlowMessagingService.kt` (line 469-473) - Writes session data
- `DataCleaner.kt` - Clears StockFlowPrefs but NOT called on org switch

**Evidence:**
```kotlin
// FirebaseService.kt line 92-94
val sharedPrefs = context.getSharedPreferences("StockFlowPrefs", Context.MODE_PRIVATE)
val activeSessionId = sharedPrefs.getString("activeStockTakeSessionId", null)
val activeOrgId = sharedPrefs.getString("activeStockTakeOrgId", null)
// ❌ BUG: Uses cached session from PREVIOUS organization
```

---

### **ISSUE #2: Notifications Not Filtered By Organization** ⛔
**Severity:** 🔴 Critical  
**Impact:** Receive notifications from deleted organizations

**Root Cause:**
- `RealTimeNotificationService` creates ONE listener per app session
- When organization changes, listener remains active for OLD organization
- `lastQuantities` map accumulates items from multiple organizations

**Files Affected:**
- `RealTimeNotificationService.kt` (line 30-39, 47-109)

**Evidence:**
```kotlin
// Line 30-39: Prevents duplicate, but doesn't recreate on org change
fun startListening() {
    // Prevent duplicate listeners
    if (listenerRegistration != null) {
        Log.d(TAG, "Notification listener already active, skipping setup")
        return  // ❌ BUG: Returns without checking if ORG changed!
    }
```

---

### **ISSUE #3: No Organization Switch Cleanup Handler** ⛔
**Severity:** 🔴 Critical  
**Impact:** Stale data from previous organization persists

**Root Cause:**
- `LoginScreen.kt` saves new organization ID
- **No cleanup logic for previous organization's data**
- Firebase listeners remain active for old organization

**Files Affected:**
- `LoginScreen.kt` (line 180-189)
- `UserPreferences.kt` - Only saves, never triggers cleanup

**Evidence:**
```kotlin
// LoginScreen.kt line 180-184
if (task.isSuccessful) {
    // Save user preferences for next login
    userPrefs.saveLastEmail(email)
    userPrefs.saveOrganizationId(organizationId)  // ❌ Overwrites without cleanup
    
    // ❌ MISSING: Clear old organization data
    // ❌ MISSING: Stop old Firebase listeners
```

---

### **ISSUE #4: Cached Inventory Not Organization-Scoped** ⚠️
**Severity:** ⚠️ High  
**Impact:** Old inventory items appear in new organization

**Root Cause:**
- Inventory cached to SQLite/Room database
- Database not partitioned by organization ID
- When switching orgs, old inventory remains in cache

**Files Affected:**
- `LoginScreen.kt` (line 183-192) - Caches inventory
- `InventoryRepository` - Cache not org-scoped

**Evidence:**
```kotlin
// LoginScreen.kt line 183-192
// Cache inventory items locally for offline stock take
CoroutineScope(Dispatchers.IO).launch {
    try {
        cacheInventoryItemsLocally(context)
        // ❌ BUG: Adds to cache without clearing previous org's items
        android.util.Log.d("LoginScreen", "✅ Inventory cached successfully")
```

---

### **ISSUE #5: Multiple SharedPreferences Files Create Data Islands** ⚠️
**Severity:** ⚠️ High  
**Impact:** Inconsistent state across different preference stores

**Multiple Preference Files Found:**
1. `UserPreferences` → "TrendStockPrefs" (orgId, lastEmail)
2. `PreferencesManager` → "TrendMobilityPrefs" (search, screen state)
3. `StockFlowPrefs` → direct access (stock take sessions)
4. `FCM_TOKEN` → direct access (push notifications)
5. `Settings` → direct access (user settings)

**Problem:** No centralized organization switch invalidates ALL stores

---

### **ISSUE #6: Firebase Listener Cleanup Inconsistent** ⚠️
**Severity:** ⚠️ High  
**Impact:** Memory leaks, duplicate listeners, wrong org data

**Root Cause:**
- `RealTimeNotificationService.stopListening()` exists but never called on org switch
- `FirebaseService.listenToStocks()` returns `ListenerRegistration` but caller may not clean up

---

### **ISSUE #7: OrganizationManager Has No Switch Method** ⚠️
**Severity:** ⚠️ High  
**Impact:** No centralized way to handle organization changes

**Current State:**
```kotlin
object OrganizationManager {
    fun getCurrentOrganizationId(): String? {
        return context?.let { ctx ->
            UserPreferences.getInstance(ctx).getOrganizationId()
        }
    }
    // ❌ MISSING: fun switchOrganization(newOrgId: String)
}
```

---

## 🔧 SOLUTION ARCHITECTURE

### **Fix Strategy: Centralized Organization Switch Handler**

```kotlin
// New OrganizationManager with proper cleanup
object OrganizationManager {
    
    private var currentOrgId: String? = null
    private val switchListeners = mutableListOf<OrganizationSwitchListener>()
    
    interface OrganizationSwitchListener {
        fun onOrganizationSwitching(oldOrgId: String?, newOrgId: String)
        fun onOrganizationSwitched(newOrgId: String)
    }
    
    fun switchOrganization(context: Context, newOrgId: String) {
        val oldOrgId = currentOrgId
        
        if (oldOrgId == newOrgId) return // No change
        
        // 1. Notify all listeners to prepare
        switchListeners.forEach { it.onOrganizationSwitching(oldOrgId, newOrgId) }
        
        // 2. Stop all Firebase listeners
        RealTimeNotificationService.getInstance(context).stopListening()
        // Stop other listeners...
        
        // 3. Clear organization-specific data
        clearOrganizationData(context, oldOrgId)
        
        // 4. Update organization ID
        UserPreferences.getInstance(context).saveOrganizationId(newOrgId)
        currentOrgId = newOrgId
        
        // 5. Notify completion
        switchListeners.forEach { it.onOrganizationSwitched(newOrgId) }
        
        // 6. Restart listeners for new org
        RealTimeNotificationService.getInstance(context).startListening()
    }
    
    private fun clearOrganizationData(context: Context, orgId: String?) {
        // Clear stock take sessions
        val stockFlowPrefs = context.getSharedPreferences("StockFlowPrefs", MODE_PRIVATE)
        stockFlowPrefs.edit()
            .remove("activeStockTakeSessionId")
            .remove("activeStockTakeOrgId")
            .apply()
            
        // Clear cached inventory
        InventoryRepository.getInstance(context).clearCache()
        
        // Clear notification state
        RealTimeNotificationService.getInstance(context).clearState()
        
        // Clear search history, etc.
        PreferencesManager.getInstance(context).clearAll()
    }
}
```

---

## 📋 IMPLEMENTATION CHECKLIST

### Phase 1: Core Fixes (Immediate)
- [ ] Add `clearState()` to RealTimeNotificationService
- [ ] Add organization validation to `startListening()`
- [ ] Create `switchOrganization()` in OrganizationManager
- [ ] Hook organization switch into LoginScreen
- [ ] Clear StockFlowPrefs on login with different org

### Phase 2: Listener Management
- [ ] Implement OrganizationSwitchListener interface
- [ ] Register RealTimeNotificationService as listener
- [ ] Ensure all listeners are stopped before org switch
- [ ] Restart listeners after org switch completes

### Phase 3: Data Isolation
- [ ] Add organization ID to Room database tables
- [ ] Filter cached inventory by organization
- [ ] Add organization column to all cached data
- [ ] Implement selective cache clearing

### Phase 4: Testing
- [ ] Test login to Org A → login to Org B
- [ ] Verify no stock take sessions from Org A visible in Org B
- [ ] Verify notifications only from current organization
- [ ] Test deleting organization → login to new org
- [ ] Verify all cached data cleared

---

## 🎯 FILES TO MODIFY

### 1. **OrganizationManager.kt** - Add switch logic
```kotlin
Lines to add: 24-80 (new switchOrganization method)
Lines to modify: 14-22 (add switch state tracking)
```

### 2. **RealTimeNotificationService.kt** - Fix org validation
```kotlin
Lines to modify: 30-39 (add org change detection)
Lines to add: 130-140 (add clearState method)
```

### 3. **LoginScreen.kt** - Hook org switch
```kotlin
Lines to modify: 180-192 (replace with switchOrganization call)
```

### 4. **DataCleaner.kt** - Add selective clear
```kotlin
Lines to add: 120-150 (new clearOrganizationData method)
```

### 5. **FirebaseService.kt** - Add org validation
```kotlin
Lines to modify: 92-101 (validate session org matches current)
```

---

## 💡 EXPECTED IMPROVEMENTS

| Issue | Before | After |
|-------|--------|-------|
| Old stock take visible | ✅ Bug exists | ❌ Fixed - cleared on switch |
| Notifications from wrong org | ✅ Bug exists | ❌ Fixed - listener restarted |
| Cached inventory mixed | ✅ Bug exists | ❌ Fixed - org-scoped cache |
| Memory leaks | ✅ Listeners persist | ❌ Fixed - proper cleanup |
| Multiple preference islands | ✅ 5 separate stores | ✅ Centralized clear |

---

## ⚠️ RISK ASSESSMENT

**Implementation Risk:** 🟡 Medium  
- Changes touch multiple critical files
- Firebase listener management is delicate
- Must preserve existing functionality

**Testing Requirements:** 🔴 High  
- Multi-organization switching scenarios
- Long-running app sessions
- Background listener behavior
- Notification delivery timing

**Rollback Plan:**
1. Keep old code commented in same files
2. Feature flag for new organization switch logic
3. Ability to revert to old behavior if issues found

---

**Report End**
