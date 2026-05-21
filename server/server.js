const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());

const buildAllowedOrigins = () => {
  const origins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'https://stockflow-dashboard-a1aa6.web.app',
    'https://stockflow-dashboard-a1aa6.firebaseapp.com',
  ]);
  [process.env.CLIENT_URL, process.env.CORS_ORIGINS].forEach(envVal => {
    if (envVal) envVal.split(',').map(u => u.trim()).filter(Boolean).forEach(u => origins.add(u));
  });
  return [...origins];
};

const allowedOrigins = buildAllowedOrigins();
console.log('🌐 CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const strictLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);

// ── Health check — always responds, explicit CORS so it works before any auth ──
app.get('/health', (req, res) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Vary', 'Origin');
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Zoho OAuth callback alias ─────────────────────────────────────────────────
app.get(['/callback/zoho', '/zoho/callback'], (req, res) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:3001';
  const target = new URL('/callback/zoho', clientUrl);
  Object.entries(req.query || {}).forEach(([key, value]) => {
    Array.isArray(value)
      ? value.forEach(v => target.searchParams.append(key, String(v)))
      : target.searchParams.set(key, String(value));
  });
  console.log('🔀 Zoho OAuth redirect →', target.toString());
  res.redirect(302, target.toString());
});

// ── Bind port immediately — Railway healthcheck requires this ─────────────────
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 StockFlow backend listening on 0.0.0.0:${PORT}`);
});

// ── Firebase init — non-fatal so server keeps running on failure ──────────────
let firebaseReady = false;

const initFirebase = () => {
  try {
    let serviceAccount;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      // Railway sometimes stores \n as a literal backslash-n — normalise both
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    } else {
      const path = require('path');
      const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve('./firebase-admin-key.json');
      serviceAccount = require(keyPath);
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
    }

    firebaseReady = true;
    console.log('✅ Firebase Admin initialized');
  } catch (err) {
    console.error('❌ Firebase init failed — API routes will return 503:', err.message);
    // Do NOT process.exit() — keep the server alive so /health still responds
  }
};

initFirebase();

// ── Mount API routes ──────────────────────────────────────────────────────────
// safeMount wraps require() in a try-catch so a route file that crashes at load
// time (e.g. because Firebase init failed) returns 503 instead of killing the
// server process and taking /health down with it.
const safeMount = (path, routeFile, ...middlewares) => {
  try {
    const router = require(routeFile);
    app.use(path, ...middlewares, router);
  } catch (err) {
    console.error(`⚠️  Failed to load route ${routeFile} — mounting 503 handler:`, err.message);
    app.use(path, (req, res) => res.status(503).json({ error: { message: 'Service temporarily unavailable', status: 503 } }));
  }
};

safeMount('/api/devices',   './routes/devices');
safeMount('/api/stock',     './routes/stock');
safeMount('/api',           './routes/read');
safeMount('/api/admin',     './routes/admin',   strictLimiter);
safeMount('/api/billing',   './routes/billing', strictLimiter);
safeMount('/api/fcm',       './routes/fcm');
safeMount('/api/notify',    './routes/notify');
safeMount('/api/stock-take','./routes/stockTake');
safeMount('/api/zoho',      './routes/zoho');
safeMount('/api/pos',       './routes/pos');
safeMount('/api/priority',  './routes/priority');

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  const dev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    error: { message: dev ? err.message : 'Internal Server Error', status: err.status || 500 }
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: { message: 'Route not found', status: 404 } });
});

// ── Firestore listeners — start after a short delay ───────────────────────────
setTimeout(() => {
  if (!firebaseReady) {
    console.warn('⚠️ Skipping Firestore listeners — Firebase not ready');
    return;
  }
  try {
    const firestoreListenerService = require('./services/firestoreListenerService');
    firestoreListenerService.startListeners(false);
  } catch (err) {
    console.error('⚠️ Firestore listener startup failed (non-fatal):', err.message);
  }
}, 3000);

// ── Global safety net — log but don't die on unhandled async errors ───────────
// Node.js 20 terminates on unhandled rejections by default. Any async Firestore
// listener callback that throws without a catch becomes one of these. Logging
// here gives us a stack trace in Railway logs while keeping the server alive.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled promise rejection (server kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception (server kept alive):', err.message, err.stack);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`🛑 ${signal} — shutting down`);
  server.close(() => { console.log('✅ Server closed'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
