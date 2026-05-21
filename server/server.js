// ── STEP 0: Global crash guards — MUST be the very first lines ───────────────
// Registered synchronously before any other code runs so they catch everything.
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException — server kept alive:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection — server kept alive:', reason);
});

console.log('[1] Loading dependencies...');
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');
const bodyParser = require('body-parser');
const admin   = require('firebase-admin');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
console.log('[2] Dependencies loaded');

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
console.log('[3] CORS allowed origins:', allowedOrigins.join(', '));

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const strictLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);
console.log('[4] Middleware registered');

// ── Health check — always responds, always has CORS header ───────────────────
app.get('/health', (req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', (origin && allowedOrigins.includes(origin)) ? origin : '*');
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
  console.log('Zoho OAuth redirect to:', target.toString());
  res.redirect(302, target.toString());
});

// ── Bind port — Railway healthcheck requires this before any other work ───────
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[5] StockFlow backend listening on 0.0.0.0:${PORT}`);
});

// ── Firebase init ─────────────────────────────────────────────────────────────
let firebaseReady = false;

console.log('[6] Initialising Firebase Admin...');
try {
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Normalise both literal \n sequences stored by Railway and actual newlines
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.replace(/\\n/g, '\n');
    serviceAccount = JSON.parse(raw);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } else {
    const path = require('path');
    const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve('./firebase-admin-key.json');
    console.log('[6a] Loading service account from file:', keyPath);
    serviceAccount = require(keyPath);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }

  firebaseReady = true;
  console.log('[7] Firebase Admin initialised successfully');
} catch (err) {
  console.error('[7] Firebase init failed (server keeps running):', err.message);
}

// ── Mount API routes ──────────────────────────────────────────────────────────
console.log('[8] Mounting API routes...');

const safeMount = (path, routeFile, ...middlewares) => {
  try {
    const router = require(routeFile);
    app.use(path, ...middlewares, router);
    console.log(`[8] Mounted ${routeFile}`);
  } catch (err) {
    console.error(`[8] ${routeFile} failed to load (503 handler mounted): ${err.message}`);
    app.use(path, (req, res) => res.status(503).json({ error: { message: 'Service temporarily unavailable', status: 503 } }));
  }
};

safeMount('/api/devices',    './routes/devices');
safeMount('/api/stock',      './routes/stock');
safeMount('/api',            './routes/read');
safeMount('/api/admin',      './routes/admin',   strictLimiter);
safeMount('/api/billing',    './routes/billing', strictLimiter);
safeMount('/api/fcm',        './routes/fcm');
safeMount('/api/notify',     './routes/notify');
safeMount('/api/stock-take', './routes/stockTake');
safeMount('/api/zoho',       './routes/zoho');
safeMount('/api/pos',        './routes/pos');
safeMount('/api/priority',   './routes/priority');

console.log('[9] All routes mounted');

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

// ── Firestore listeners — delayed to avoid interfering with healthcheck ───────
setTimeout(() => {
  if (!firebaseReady) {
    console.warn('[10] Skipping Firestore listeners — Firebase not ready');
    return;
  }
  console.log('[10] Starting Firestore listeners...');
  try {
    const firestoreListenerService = require('./services/firestoreListenerService');
    firestoreListenerService.startListeners(false);
    console.log('[10] Firestore listeners started');
  } catch (err) {
    console.error('[10] Firestore listener startup failed (non-fatal):', err.message);
  }
}, 5000);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`${signal} received — shutting down`);
  server.close(() => { console.log('Server closed'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

console.log('[11] Server setup complete');
