# Registering Devices

After successful user authentication, devices must register their FCM tokens with the backend to receive push notifications.

## Android Example

```kotlin
// After successful Firebase Auth login
private fun registerDeviceForNotifications() {
    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        if (!task.isSuccessful) {
            Log.w("FCM", "Fetching FCM registration token failed", task.exception)
            return@addOnCompleteListener
        }

        // Get new FCM registration token
        val token = task.result
        val orgId = getCurrentUserOrgId() // Get from user's custom claims
        
        // Register with backend
        registerTokenWithBackend(token, orgId)
    }
}

private fun registerTokenWithBackend(deviceToken: String, orgId: String) {
    val client = OkHttpClient()
    val json = JSONObject().apply {
        put("orgId", orgId)
        put("deviceToken", deviceToken)
        put("platform", "android")
    }
    
    val requestBody = json.toString().toRequestBody("application/json".toMediaType())
    
    // Get Firebase ID token for authorization
    FirebaseAuth.getInstance().currentUser?.getIdToken(true)?.addOnCompleteListener { tokenTask ->
        if (tokenTask.isSuccessful) {
            val idToken = tokenTask.result?.token
            
            val request = Request.Builder()
                .url("${API_BASE_URL}/api/devices/register")
                .post(requestBody)
                .addHeader("Authorization", "Bearer $idToken")
                .addHeader("Content-Type", "application/json")
                .build()
            
            client.newCall(request).enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    if (response.isSuccessful) {
                        Log.d("FCM", "✅ Device registered for notifications")
                    } else {
                        Log.e("FCM", "❌ Device registration failed: ${response.code}")
                    }
                }
                
                override fun onFailure(call: Call, e: IOException) {
                    Log.e("FCM", "❌ Device registration network error", e)
                }
            })
        }
    }
}
```

## Web/JavaScript Example

```javascript
// After successful Firebase Auth login
import { getMessaging, getToken } from "firebase/messaging";

async function registerDeviceForNotifications() {
    try {
        // Initialize Firebase Messaging
        const messaging = getMessaging();
        
        // Get FCM token
        const token = await getToken(messaging, {
            vapidKey: 'YOUR_VAPID_KEY' // Get from Firebase Console
        });
        
        if (token) {
            console.log('FCM Token:', token);
            
            // Get user's organization ID from custom claims
            const user = auth.currentUser;
            const idToken = await user.getIdToken();
            const tokenResult = await user.getIdTokenResult();
            const orgId = tokenResult.claims.orgId;
            
            // Register with backend
            await registerTokenWithBackend(token, orgId, idToken);
        } else {
            console.log('No registration token available.');
        }
    } catch (error) {
        console.error('Error getting FCM token:', error);
    }
}

async function registerTokenWithBackend(deviceToken, orgId, idToken) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/devices/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                orgId: orgId,
                deviceToken: deviceToken,
                platform: 'web'
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Device registered for notifications:', result);
        } else {
            const error = await response.json();
            console.error('❌ Device registration failed:', error);
        }
    } catch (error) {
        console.error('❌ Device registration network error:', error);
    }
}

// Call after user login
registerDeviceForNotifications();
```

## How It Works

1. **Device Registration**: When a device calls `POST /api/devices/register`, the server:
   - Validates the user's Firebase ID token
   - Verifies the user belongs to the specified organization
   - Stores the device token in Firestore at `orgs/{orgId}/deviceTokens/{token}`
   - **Automatically subscribes the token to the organization topic `org_{orgId}`**

2. **Topic Subscription**: The server uses FCM topic subscription as a fallback mechanism:
   - **Primary**: Direct token-based notifications (more reliable)
   - **Fallback**: Topic-based notifications to `org_{orgId}` (simpler management)

3. **Notification Delivery**: When sending notifications, the server can use either:
   - `sendOrgNotificationByTokens()` - Sends to individual registered tokens
   - `sendOrgNotificationByTopic()` - Sends to the organization topic `org_{orgId}`

4. **Token Cleanup**: Invalid/expired tokens are automatically removed during notification attempts to keep the database clean.

## Important Notes

- **Security**: All device registration requires valid Firebase ID token authentication
- **Organization Isolation**: Users can only register devices for their own organization
- **Platform Tracking**: The server tracks device platform (android/web/ios) for analytics
- **Automatic Cleanup**: Invalid tokens are automatically removed during notification sends
- **Topic Naming**: Organization topics follow the pattern `org_{orgId}` (e.g., `org_company123`)