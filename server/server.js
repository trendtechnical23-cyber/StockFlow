// ── STEP 0: Global crash guards ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException — server kept alive:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection — server kept alive:', reason);
});

require('dotenv').config();

// ── Startup env diagnostic ─────────────────────────────────────────────────────
// Logged once at boot — visible in Railway Logs → helps confirm env vars are set.
console.log('[ENV] ZOHO_REDIRECT_URI =', process.env.ZOHO_REDIRECT_URI || '⚠️  NOT SET');
console.log('[ENV] CLIENT_URL        =', process.env.CLIENT_URL        || '⚠️  NOT SET');
console.log('[ENV] SUPABASE_URL      =', process.env.SUPABASE_URL      ? '✅ set' : '⚠️  NOT SET');
console.log('[ENV] SUPABASE_SERVICE_ROLE_KEY =', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ set' : '⚠️  NOT SET');

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const bodyParser = require('body-parser');
const rateLimit  = require('express-rate-limit');

const app = express();

// ── Trust proxy — REQUIRED on Railway/Vercel (runs behind a load balancer) ────
// Without this, express-rate-limit reads the wrong client IP and logs warnings.
app.set('trust proxy', 1);

// ── Helmet ────────────────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
const buildAllowedOrigins = () => {
  const origins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ]);
  [process.env.CLIENT_URL, process.env.CORS_ORIGINS].forEach(envVal => {
    if (envVal) envVal.split(',').map(u => u.trim().replace(/\/+$/, '')).filter(Boolean).forEach(u => origins.add(u));
  });
  return [...origins];
};

const allowedOrigins = buildAllowedOrigins();

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  const clean = origin.replace(/\/+$/, '');
  if (allowedOrigins.includes(clean)) return true;
  try {
    const { hostname } = new URL(clean);
    if (hostname.endsWith('.vercel.app')) return true;
  } catch { /* malformed origin */ }
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
app.options('*', cors(corsOptions));
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
// trust proxy must be set BEFORE these or IP detection is unreliable on Railway
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const strictLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
// Defined early so Railway gets a 200 immediately on startup.
// Does NOT depend on any external service — pure uptime check.
app.get('/health', (req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', (origin && isAllowedOrigin(origin)) ? origin : '*');
  res.setHeader('Vary', 'Origin');
  res.status(200).json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ── Zoho OAuth redirect ───────────────────────────────────────────────────────
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

// ── Bind port ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
console.log(`[BOOT] Binding to port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[BOOT] Port ${PORT} bound — accepting connections`);
  console.log(`[BOOT] CORS origins: ${allowedOrigins.join(', ')}`);
  mountRoutes();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const gracefulShutdown = (signal) => {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => { console.log('[BOOT] Server closed'); process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Route mounting ────────────────────────────────────────────────────────────
// All routes use Supabase. Firebase Admin is no longer a dependency.
// safeMount wraps require() so a single broken route file never takes down
// the entire server — it mounts a 503 stub for that path only.
function mountRoutes() {
  console.log('[ROUTES] Mounting API routes...');

  const safeMount = (mountPath, routeFile, ...middlewares) => {
    try {
      const router = require(routeFile);
      app.use(mountPath, ...middlewares, router);
      console.log(`[ROUTES] ✅ ${mountPath} → ${routeFile}`);
    } catch (err) {
      console.error(`[ROUTES] ❌ Failed to load ${routeFile}: ${err.message}`);
      // Only this path gets a 503 stub — all other routes are unaffected
      app.use(mountPath, (_req, res) =>
        res.status(503).json({ error: { message: `Route unavailable: ${routeFile}`, detail: err.message, status: 503 } })
      );
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

  console.log('[ROUTES] All routes mounted — server fully ready');

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    const dev = process.env.NODE_ENV === 'development';
    res.status(err.status || 500).json({
      error: { message: dev ? err.message : 'Internal Server Error', status: err.status || 500 }
    });
  });

  app.use('*', (req, res) => {
    res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}`, status: 404 } });
  });
}
