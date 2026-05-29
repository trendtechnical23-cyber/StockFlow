// ── STEP 0: Global crash guards ───────────────────────────────────────────────
// Keep the process alive on uncaught exceptions / rejections.
// These should be rare — they represent programming bugs, not operational errors.
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException — server kept alive:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection — server kept alive:', reason);
});

require('dotenv').config();

// ── Startup env diagnostic ────────────────────────────────────────────────────
const _zruri = (process.env.ZOHO_REDIRECT_URI || '').trim();
console.log('[ENV] ZOHO_REDIRECT_URI         =', _zruri || '⚠️  NOT SET', `(len=${_zruri.length})`);
console.log('[ENV] CLIENT_URL                =', process.env.CLIENT_URL                || '⚠️  NOT SET');
console.log('[ENV] SUPABASE_URL              =', process.env.SUPABASE_URL              ? '✅ set' : '⚠️  NOT SET');
console.log('[ENV] SUPABASE_SERVICE_ROLE_KEY =', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ set' : '⚠️  NOT SET');
console.log('[ENV] NODE_ENV                  =', process.env.NODE_ENV || 'development');

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const { notFoundHandler, errorHandler } = require('./middleware/errors');

const app = express();
const isDev = process.env.NODE_ENV !== 'production';

// ── 1. Trust proxy ─────────────────────────────────────────────────────────────
// Must be first. Railway runs behind a load balancer; without this, rate-limit
// reads the wrong client IP and express logs incorrect remote addresses.
app.set('trust proxy', 1);

// ── 2. Security headers ───────────────────────────────────────────────────────
// Helmet sets safe defaults: X-Content-Type-Options, X-Frame-Options, CSP, etc.
// Place before CORS so security headers are always present, even on rejected origins.
app.use(helmet());

// ── 3. CORS ───────────────────────────────────────────────────────────────────
const buildAllowedOrigins = () => {
  const origins = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ]);
  [process.env.CLIENT_URL, process.env.CORS_ORIGINS].forEach(envVal => {
    if (envVal) {
      envVal.split(',')
        .map(u => u.trim().replace(/\/+$/, ''))
        .filter(Boolean)
        .forEach(u => origins.add(u));
    }
  });
  return [...origins];
};

const allowedOrigins = buildAllowedOrigins();

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // same-origin / server-to-server requests
  const clean = origin.replace(/\/+$/, '');
  if (allowedOrigins.includes(clean)) return true;
  try {
    const { hostname } = new URL(clean);
    if (hostname.endsWith('.vercel.app')) return true;
  } catch { /* malformed — deny */ }
  return false;
};

const corsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    console.warn('[CORS] Blocked origin:', origin);
    cb(null, false);
  },
  credentials: true,
};

// app.use(cors) handles both regular requests AND OPTIONS preflight in one shot.
// The explicit app.options line ensures preflight is answered BEFORE any auth
// middleware can reject it (preflight carries no Authorization header).
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── 4. Request logger ─────────────────────────────────────────────────────────
// 'dev' format: coloured, concise — great for local development.
// 'combined' format: Apache-style, includes IP + user-agent — good for production logs.
app.use(morgan(isDev ? 'dev' : 'combined'));

// ── 5. Body parsers ───────────────────────────────────────────────────────────
// Use Express built-ins (available since 4.16) — no need for the body-parser package.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── 6. Rate limiting ──────────────────────────────────────────────────────────
// Must come after trust proxy (step 1).
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests — please slow down.', status: 429 } },
});
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Rate limit reached for this action.', status: 429 } },
});

app.use('/api/', generalLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
// Defined before routes so Railway gets a 200 immediately at startup.
// Bypasses auth, rate limiting, and all route files — pure uptime check.
app.get('/health', (req, res) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', (origin && isAllowedOrigin(origin)) ? origin : '*');
  res.setHeader('Vary', 'Origin');
  res.status(200).json({
    ok: true,
    uptime: Math.round(process.uptime()),
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ── Zoho OAuth redirect relay ─────────────────────────────────────────────────
// Zoho sends the browser here after the user approves.
// We immediately redirect to the Vercel frontend so the callback page can
// pick up the code + state parameters.
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
  console.log(`[BOOT] ${signal} received — draining connections...`);
  server.close(() => {
    console.log('[BOOT] All connections closed — exiting');
    process.exit(0);
  });
  // Hard kill after 10 s if connections don't drain
  setTimeout(() => {
    console.error('[BOOT] Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Route mounting ────────────────────────────────────────────────────────────
// safeMount: if a route file throws at require() time, only that path gets a
// 503 stub — every other route is unaffected.
function mountRoutes() {
  console.log('[ROUTES] Mounting API routes...');

  const safeMount = (mountPath, routeFile, ...middlewares) => {
    try {
      const router = require(routeFile);
      app.use(mountPath, ...middlewares, router);
      console.log(`[ROUTES] ✅  ${mountPath}`);
    } catch (err) {
      console.error(`[ROUTES] ❌  ${mountPath} — failed to load ${routeFile}: ${err.message}`);
      app.use(mountPath, (_req, res) =>
        res.status(503).json({
          success: false,
          error: { message: `Service temporarily unavailable: ${mountPath}`, status: 503 },
        }),
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

  // ── 404 handler ─────────────────────────────────────────────────────────────
  // Must be AFTER all route files so unmatched requests fall through to it.
  app.use(notFoundHandler);

  // ── Global error handler ─────────────────────────────────────────────────────
  // Must be LAST and have exactly 4 arguments (err, req, res, next).
  // Handles AppErrors from routes, Postgres errors, and unexpected crashes.
  app.use(errorHandler);
}
