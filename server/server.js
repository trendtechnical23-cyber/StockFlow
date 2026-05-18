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
      // Production (Railway): credentials supplied as a JSON string env var.
      // Some platforms mangle \n in the private_key to literal newlines — fix both cases.
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      serviceAccount = JSON.parse(raw);
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
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
  const PORT = process.env.PORT || 4000;
  // Bind to 0.0.0.0 in production so Railway can route traffic to the container
  const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST || 'localhost');

  // ── Bind the port FIRST so Railway's healthcheck can hit /health immediately ──
  // Routes are mounted below after Firebase is ready; /health is already defined above.
  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 StockFlow backend listening on ${HOST}:${PORT}`);
    console.log(`📡 Health: http://localhost:${PORT}/health`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // ── Initialize Firebase (network call — can take a few seconds) ──
  await initializeFirebase();

  // ── Mount all routes now that Firebase is ready ──
  app.use('/api/devices', require('./routes/devices'));
  app.use('/api/stock', require('./routes/stock'));
  app.use('/api', require('./routes/read'));
  app.use('/api/admin', strictLimiter, require('./routes/admin'));
  app.use('/api/billing', strictLimiter, require('./routes/billing'));
  app.use('/api/fcm', require('./routes/fcm'));
  app.use('/api/notify', require('./routes/notify'));
  app.use('/api/stock-take', require('./routes/stockTake'));
  app.use('/api/zoho', require('./routes/zoho'));
  app.use('/api/pos', require('./routes/pos'));
  app.use('/api/priority', require('./routes/priority'));

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Error Details:', { message: err.message, stack: err.stack, path: req.path, method: req.method });
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
    res.status(404).json({ error: { message: 'Route not found', status: 404 } });
  });

  // ── Start Firestore listeners after routes are mounted ──
  const firestoreListenerService = require('./services/firestoreListenerService');
  setTimeout(() => {
    firestoreListenerService.startListeners(false);
  }, 2000);

  console.log('✅ All routes mounted. Firebase + FCM active.');

  // Graceful shutdown
  const gracefulShutdown = (signal) => {
    console.log(`🛑 ${signal} received — shutting down...`);
    firestoreListenerService.stopListeners();
    server.close(() => {
      console.log('✅ Server closed');
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
