// ── STEP 0: Global crash guards — MUST be the very first lines ───────────────
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException — server kept alive:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection — server kept alive:', reason);
});

// ── STEP 1: Load ONLY the minimal modules needed to bind the port ─────────────
// firebase-admin is intentionally NOT required here — it is a large package
// that can take several seconds to load and would block the event loop before
// the port is bound, causing Railway's healthcheck to time out.
require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const bodyParser = require('body-parser');
const rateLimit  = require('express-rate-limit');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());

const buildAllowedOrigins = () => {
  const origins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ]);
  // Add explicit production origins via env vars (CLIENT_URL / CORS_ORIGINS, comma-separated)
  [process.env.CLIENT_URL, process.env.CORS_ORIGINS].forEach(envVal => {
    if (envVal) envVal.split(',').map(u => u.trim().replace(/\/+$/, '')).filter(Boolean).forEach(u => origins.add(u));
  });
  return [...origins];
};

const allowedOrigins = buildAllowedOrigins();

// Vercel generates many domains per project: production, git-branch, and per-commit
// preview URLs all under *.vercel.app. Rather than hardcode each, allow any of them.
const isAllowedOrigin = (origin) => {
  if (!origin) return true;                               // same-origin / curl / server-to-server
  const clean = origin.replace(/\/+$/, '');
  if (allowedOrigins.includes(clean)) return true;
  try {
    const { hostname } = new URL(clean);
    if (hostname.endsWith('.vercel.app')) return true;    // any Vercel deployment of this project
  } catch { /* malformed origin — fall through to deny */ }
  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    console.warn('[CORS] Blocked origin:', origin);
    return callback(null, false);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));   // ensure preflight requests get CORS headers too
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const strictLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);

// ── Health check — defined BEFORE port binding so it's ready immediately ──────
let appReady = false;
app.get('/health', (req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', (origin && isAllowedOrigin(origin)) ? origin : '*');
  res.setHeader('Vary', 'Origin');
  res.status(200).json({ status: appReady ? 'ok' : 'starting', timestamp: new Date().toISOString() });
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
  res.redirect(302, target.toString());
});

// ── STEP 2: Bind port IMMEDIATELY — before loading firebase-admin ─────────────
// This guarantees Railway's healthcheck gets a 200 within milliseconds of
// process start, regardless of how long Firebase init takes.
const PORT = process.env.PORT || 4000;
console.log(`[BOOT] Binding to port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BOOT] Port ${PORT} bound — server accepting connections`);
  console.log(`[BOOT] CORS origins: ${allowedOrigins.join(', ')}`);

  // ── STEP 3: Load firebase-admin + everything else AFTER port is bound ────────
  // Runs in the listen callback so the port is already accepting connections.
  initApplication();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`${signal} received — shutting down`);
  server.close(() => { console.log('Server closed'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Firebase + routes — runs after port is bound
// ─────────────────────────────────────────────────────────────────────────────
function initApplication() {
  // ── Firebase Admin init ───────────────────────────────────────────────────
  let firebaseReady = false;
  let admin;

  console.log('[FIREBASE] Loading firebase-admin...');
  try {
    admin = require('firebase-admin');
    console.log('[FIREBASE] firebase-admin loaded');

    let credential;

    if (process.env.FIREBASE_PRIVATE_KEY) {
      // Preferred: individual vars — Railway stores these cleanly (no JSON issues)
      console.log('[FIREBASE] Using individual FIREBASE_* env vars');
      credential = admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });

    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Fallback: full JSON blob — two-strategy parse to handle Railway's
      // broken newline encoding inside JSON strings
      console.log('[FIREBASE] Parsing FIREBASE_SERVICE_ACCOUNT_JSON...');
      let serviceAccount;
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      try {
        serviceAccount = JSON.parse(raw.replace(/\\n/g, '\n'));
      } catch (_) {
        const escaped = raw
          .replace(/\r\n/g, '\\n')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\n');
        serviceAccount = JSON.parse(escaped);
      }
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      credential = admin.credential.cert(serviceAccount);

    } else {
      // Last resort: key file on disk (works locally, not on Railway)
      const path = require('path');
      const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve('./firebase-admin-key.json');
      console.log('[FIREBASE] Loading service account from file:', keyPath);
      credential = admin.credential.cert(require(keyPath));
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
    }

    firebaseReady = true;
    appReady = true;
    console.log('[FIREBASE] Firebase Admin initialised successfully');

  } catch (err) {
    console.error('[FIREBASE] Firebase init failed (server keeps running):', err.message);
    console.error('[FIREBASE] Tip: set FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in Railway Variables');
    // Server keeps running — /health still returns 200 (status: 'starting')
    // API routes will return 503 (safeMount handles it)
  }

  // ── Mount API routes ────────────────────────────────────────────────────────
  console.log('[ROUTES] Mounting API routes...');

  const safeMount = (mountPath, routeFile, ...middlewares) => {
    try {
      const router = require(routeFile);
      app.use(mountPath, ...middlewares, router);
      console.log(`[ROUTES] Mounted ${routeFile}`);
    } catch (err) {
      console.error(`[ROUTES] ${routeFile} failed to load (503 handler mounted): ${err.message}`);
      app.use(mountPath, (req, res) => res.status(503).json({ error: { message: 'Service temporarily unavailable', status: 503 } }));
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

  console.log('[ROUTES] All routes mounted');

  // ── Error handler + 404 ────────────────────────────────────────────────────
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

  // ── Firestore listeners — 5 s delay so healthcheck traffic isn't disrupted ──
  setTimeout(() => {
    if (!firebaseReady) {
      console.warn('[LISTENERS] Skipping Firestore listeners — Firebase not ready');
      return;
    }
    console.log('[LISTENERS] Starting Firestore listeners...');
    try {
      const firestoreListenerService = require('./services/firestoreListenerService');
      firestoreListenerService.startListeners(false);
      console.log('[LISTENERS] Firestore listeners started');
    } catch (err) {
      console.error('[LISTENERS] Firestore listener startup failed (non-fatal):', err.message);
    }
  }, 5000);

  console.log('[BOOT] Application initialisation complete');
}
