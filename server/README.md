# Inventory Management Backend

A Node.js Express backend with Firebase integration for inventory management, notifications, and user authentication.

## 🚀 Quick Start

### 1. Environment Setup

Create a `.env` file in the `server/` directory with the following variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Firebase Configuration
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour-Private-Key-Here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/service_account_x509_cert_url

# Admin Configuration
ADMIN_ORG_ID=admin
BOOTSTRAP_SECRET=your-super-secure-bootstrap-secret-key
```

### 2. Firebase Service Account Key

**Option A: Service Account JSON File (Recommended for Development)**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project → Project Settings → Service Accounts
3. Click "Generate New Private Key"
4. Save the downloaded JSON file as `server/serviceAccountKey.json`
5. **Important**: Add `serviceAccountKey.json` to your `.gitignore`

**Option B: Environment Variables (Recommended for Production)**
Use the individual environment variables listed above instead of the JSON file.

### 3. Installation & Running

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Start development server
npm run dev
```

The server will start on `http://localhost:3001` (or your specified PORT).

## 🔐 Firebase Custom Claims Setup

### Admin User Setup Flow

1. **Create Admin User** (via Firebase Console or your frontend):
   ```javascript
   // User registers normally through your frontend
   // Firebase Auth creates user with UID
   ```

2. **Set Admin Claims** (via your backend):
   ```bash
   # POST to /api/admin/setUserOrg
   # Include Bootstrap Secret for initial admin setup
   ```

3. **Example Admin Setup Request**:
   ```json
   POST /api/admin/setUserOrg
   Content-Type: application/json

   {
     "uid": "firebase-user-uid-here",
     "orgId": "admin", 
     "roles": ["admin", "manager"],
     "bootstrapSecret": "your-super-secure-bootstrap-secret-key"
   }
   ```

### Regular User Setup Flow

1. **Admin sets user organization**:
   ```json
   POST /api/admin/setUserOrg
   Authorization: Bearer <admin-firebase-id-token>

   {
     "uid": "user-firebase-uid",
     "orgId": "company123",
     "roles": ["user"]
   }
   ```

2. **User can now access organization data**:
   - Custom claims: `{ orgId: "company123", roles: ["user"] }`
   - Can access `/orgs/company123/` Firestore collections

## 🧪 Testing with Postman

### 1. Get Firebase ID Token

**Method A: From your frontend JavaScript:**
```javascript
import { getAuth } from 'firebase/auth';

const user = getAuth().currentUser;
if (user) {
  const token = await user.getIdToken();
  console.log('ID Token:', token);
}
```

**Method B: Using Firebase REST API:**
```bash
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=YOUR_API_KEY
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "returnSecureToken": true
}
```

### 2. Test Stock Update Endpoint

```json
POST http://localhost:3001/api/stock/update
Authorization: Bearer YOUR_FIREBASE_ID_TOKEN
Content-Type: application/json

{
  "itemId": "item123",
  "quantity": 50,
  "operation": "set",
  "reason": "Stock replenishment"
}
```

### 3. Expected Response
```json
{
  "success": true,
  "message": "Stock updated successfully",
  "data": {
    "itemId": "item123",
    "oldQuantity": 25,
    "newQuantity": 50,
    "operation": "set",
    "timestamp": "2025-10-07T10:30:00.000Z"
  }
}
```

### 4. Common Test Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/admin/setUserOrg` | Set user organization |
| POST | `/api/devices/register` | Register device token |
| POST | `/api/stock/update` | Update stock quantity |
| GET | `/api/read/inventory/:orgId` | Get inventory data |
| GET | `/api/read/activity/:orgId` | Get activity logs |

## 🐛 Debugging Tips

### 1. Common Issues

**"Firebase app named '[DEFAULT]' already exists"**
- Restart the server
- Check for multiple Firebase initialization calls

**"Insufficient permissions" or "orgId mismatch"**
- Verify user has correct custom claims: `{ orgId: "expected-org" }`
- Check Firebase ID token is valid and not expired
- Ensure user is accessing correct organization endpoints

**"Invalid token" errors**
- Token expires every 1 hour - get a fresh one
- Ensure token includes `Bearer ` prefix in Authorization header
- Verify Firebase project configuration

### 2. Debugging Commands

**Check server logs:**
```bash
# Server logs include emojis for easy identification
# 🔐 = Authentication events
# 📦 = Stock operations  
# 🔔 = Notifications
# ❌ = Errors
```

**Test Firebase connection:**
```bash
# Check if Firebase Admin SDK initializes properly
# Look for: "🔥 Firebase Admin initialized successfully"
```

**Verify custom claims:**
```javascript
// In your frontend, check user claims:
const user = getAuth().currentUser;
if (user) {
  const token = await user.getIdToken(true); // Force refresh
  const claims = (await user.getIdTokenResult()).claims;
  console.log('Custom claims:', claims);
}
```

### 3. Environment Issues

**Missing environment variables:**
- Check `.env` file exists in `server/` directory
- Verify all required variables are set
- Restart server after changing `.env`

**Service account key issues:**
- Ensure `serviceAccountKey.json` has correct permissions
- Verify JSON structure is valid
- Check file path: `server/serviceAccountKey.json`

### 4. Firestore Rules

Ensure your Firestore security rules allow authenticated users to access their organization's data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their organization's data
    match /orgs/{orgId}/{document=**} {
      allow read, write: if request.auth != null 
        && request.auth.token.orgId == orgId;
    }
  }
}
```

### 5. Logging Levels

The server uses detailed console logging:
- ✅ Success operations (green)
- ⚠️ Warnings (yellow)  
- ❌ Errors (red)
- 🔍 Debug information (blue)

### 6. Network Issues

**CORS errors:**
- Ensure your frontend domain is in the CORS configuration
- Check `server.js` CORS settings match your frontend URL

**Port conflicts:**
- Default port is 3001
- Change `PORT` in `.env` if needed
- Ensure port is not blocked by firewall

## 📚 API Documentation

### Authentication
All API endpoints (except health check) require a valid Firebase ID token in the Authorization header:
```
Authorization: Bearer <firebase-id-token>
```

### Endpoints Overview
- **Admin**: `/api/admin/*` - User management
- **Devices**: `/api/devices/*` - Push notification registration  
- **Stock**: `/api/stock/*` - Inventory updates
- **Read**: `/api/read/*` - Data retrieval

For detailed API documentation, see the individual route files in `routes/`.

## 🔒 Security Notes

- Never commit `.env` or `serviceAccountKey.json` to version control
- Use strong `BOOTSTRAP_SECRET` for initial admin setup
- Regularly rotate Firebase service account keys
- Implement proper Firestore security rules
- Monitor Firebase Auth usage and quotas

## 📦 Dependencies

### Production
- `express` - Web framework
- `firebase-admin` - Firebase Admin SDK
- `cors` - Cross-origin resource sharing
- `helmet` - Security headers
- `morgan` - HTTP request logger
- `express-rate-limit` - Rate limiting

### Development
- `nodemon` - Auto-restart on file changes
- `dotenv` - Environment variable loading

## 🚀 Deployment

For production deployment:
1. Set environment variables (don't use `.env` file)
2. Use Firebase service account environment variables
3. Set `NODE_ENV=production`
4. Configure proper CORS origins
5. Set up monitoring and logging
6. Use process managers like PM2

---

**Need help?** Check the logs first - they include detailed error messages and debugging information with emoji indicators for quick identification.