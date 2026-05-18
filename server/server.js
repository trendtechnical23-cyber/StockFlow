const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Initialize Express app
const app = express();

// Security and logging middleware
app.use(helmet());
// CORS configuration
const getAllowedOrigins = () => {
  const origins = [
    'http://localhost:3000',
    'http://localhost:3001', 
    'http://localhost:5173'
  ];
  
  // Add production origin from environment
  if (process.env.CLIENT_URL) {
    origins.push(process.env.CLIENT_URL);
  }
  
  return origins;
};

app.use(cors({
  origin: getAllowedOrigins(),
  credentials: true
}));
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting configuration for security
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs for sensitive endpoints
  message: 'Too many attempts, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all API routes
app.use('/api/', generalLimiter);

// Initialize Firebase Admin
const initializeFirebase = async () => {
  try {
    let serviceAccount;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Production (Railway): credentials supplied as a JSON string env var
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      // Local dev: credentials loaded from a file
      serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    } else {
      throw new Error('No Firebase credentials supplied. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });

    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error.message);
    process.exit(1);
  }
};

// Health check endpoint (available before Firebase init)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Zoho OAuth callback aliases
// If Zoho is configured to redirect to backend host/path, forward to frontend callback route.
app.get(['/callback/zoho', '/zoho/callback'], (req, res) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3001';
  const target = new URL('/callback/zoho', clientUrl);

  // Forward all query params from Zoho (code, state, etc.)
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => target.searchParams.append(key, String(item)));
    } else if (value !== undefined && value !== null) {
      target.searchParams.set(key, String(value));
    }
  });

  console.log('🔀 Zoho OAuth redirect →', target.toString());
  res.redirect(302, target.toString());
});

// Start server
const startServer = async () => {
  // Initialize Firebase first
  await initializeFirebase();
  
  // Initialize FCM and Firestore listeners
  const firestoreListenerService = require('./services/firestoreListenerService');
  
  // Start Firestore listeners for automatic notifications in LAZY mode.
  // This starts only the global `activities` listener to avoid opening per-org
  // listeners for every organization at startup (which can cause Firestore
  // RESOURCE_EXHAUSTED / quota exceeded errors). Per-org listeners are started
  // when a device registers or an org becomes active.
  setTimeout(() => {
    firestoreListenerService.startListeners(/* startAll */ false);
  }, 2000); // Small delay to ensure Firebase is fully initialized

  // Mount routes after Firebase is initialized with appropriate rate limiting
  app.use('/api/devices', require('./routes/devices'));
  app.use('/api/stock', require('./routes/stock'));
  app.use('/api', require('./routes/read')); // Handles /api/inventory and /api/activity
  
  // Strict rate limiting for sensitive endpoints
  app.use('/api/admin', strictLimiter, require('./routes/admin'));
  app.use('/api/billing', strictLimiter, require('./routes/billing'));
  
  // Standard rate limiting for notification endpoints
  app.use('/api/fcm', require('./routes/fcm'));
  app.use('/api/notify', require('./routes/notify'));
  app.use('/api/stock-take', require('./routes/stockTake'));
  app.use('/api/zoho', require('./routes/zoho'));
  app.use('/api/pos', require('./routes/pos'));
  app.use('/api/priority', require('./routes/priority'));

  // Error handler middleware - prevents information disclosure in production
  app.use((err, req, res, next) => {
    // Log full error details server-side for debugging
    console.error('Error Details:', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ip: req.ip
    });
    
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(err.status || 500).json({
      error: {
        message: isDevelopment ? err.message : 'Internal Server Error',
        status: err.status || 500,
        ...(isDevelopment && { stack: err.stack })
      }
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      error: {
        message: 'Route not found',
        status: 404
      }
    });
  });
  
  const PORT = process.env.PORT || 4000;

  // Bind to 0.0.0.0 in production so Railway can route traffic to the container
  const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST || 'localhost');

  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Inventory Backend Server running on ${HOST}:${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    
    // Show network access info
    const os = require('os');
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach(interfaceName => {
      interfaces[interfaceName].forEach(interfaceInfo => {
        if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
          console.log(`🌐 Network access: http://${interfaceInfo.address}:${PORT}`);
        }
      });
    });
    console.log(`🔥 Firebase Admin initialized`);
    console.log(`📱 FCM integration active`);
    console.log(`🔗 Zoho Books integration active`);
    console.log(`firestore listeners starting...`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`
📋 Available FCM endpoints:
`);
    console.log(`   POST /api/fcm/test-notify/:userId - Send test notification`);
    console.log(`   POST /api/fcm/send-to-user - Send notification to specific user`);
    console.log(`   POST /api/fcm/send-to-organization - Send notification to all users`);
    console.log(`   GET  /api/fcm/stats/:orgId - Get notification statistics`);
    console.log(`   GET  /api/fcm/test-examples - View API usage examples`);
    console.log(`
🔗 Available Zoho Books endpoints:
`);
    console.log(`   GET  /api/zoho/test - Test Zoho Books connection`);
    console.log(`   GET  /api/zoho/items - Get all items from Zoho`);
    console.log(`   POST /api/zoho/items - Create item in Zoho`);
    console.log(`   PUT  /api/zoho/items/:id - Update item in Zoho`);
    console.log(`   POST /api/zoho/items/:id/adjust-stock - Adjust item stock`);
    console.log(`   POST /api/zoho/sync/items - Bulk sync items to Zoho`);
    console.log(`   GET  /api/zoho/organization - Get organization info
`);
    console.log(`
🛒 Available POS endpoints:
`);
    console.log(`   GET  /api/pos/providers - List supported POS providers`);
    console.log(`   POST /api/pos/connect - Connect to a POS system`);
    console.log(`   POST /api/pos/disconnect - Disconnect POS integration`);
    console.log(`   GET  /api/pos/test - Test POS connection`);
    console.log(`   GET  /api/pos/status - Get POS integration status`);
    console.log(`   GET  /api/pos/items - Fetch items from POS
`);
  });

  // Graceful shutdown
  const gracefulShutdown = (signal) => {
    console.log(`
🛑 Received ${signal}. Starting graceful shutdown...`);
    
    // Stop Firestore listeners
    firestoreListenerService.stopListeners();
    
    // Close server
    server.close(() => {
      console.log('✅ Server closed successfully');
      process.exit(0);
    });
    
    // Force close after 10 seconds
    setTimeout(() => {
      console.log('❌ Forced shutdown after 10 seconds');
      process.exit(1);
    }, 10000);
  };

  // Handle shutdown signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
};

startServer().catch(console.error);
