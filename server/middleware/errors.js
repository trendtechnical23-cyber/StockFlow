/**
 * StockFlow — structured error handling middleware.
 *
 * Three exports consumed by server.js:
 *
 *   AppError       — throw this for known, operational failures (bad input,
 *                    not found, auth denied).  Message is always safe to show.
 *
 *   asyncHandler   — wraps async route handlers so any thrown error or rejected
 *                    promise automatically reaches next(err) without try/catch
 *                    boilerplate in every route file.
 *
 *   notFoundHandler — mounts AFTER all routes; converts unmatched requests into
 *                     AppError(404) so the errorHandler formats them correctly.
 *
 *   errorHandler   — 4-argument Express error middleware; MUST be the last
 *                    middleware registered (after all routes and notFoundHandler).
 */

// ── AppError ──────────────────────────────────────────────────────────────────

class AppError extends Error {
  /**
   * @param {string}  message    Safe, human-readable explanation.
   * @param {number}  statusCode HTTP status (4xx = client fault, 5xx = server fault).
   * @param {string}  [code]     Optional machine-readable code (e.g. 'NOT_FOUND').
   */
  constructor(message, statusCode, code) {
    super(message);
    this.name       = 'AppError';
    this.statusCode = statusCode;
    this.status     = statusCode < 500 ? 'fail' : 'error';
    this.code       = code || null;
    this.isOperational = true; // flag: expected failure, not a programming bug
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── asyncHandler ──────────────────────────────────────────────────────────────

/**
 * Wraps an async route handler so any rejection / thrown error reaches next(err).
 *
 * Before:
 *   router.get('/items', async (req, res, next) => {
 *     try { ... } catch (err) { next(err); }
 *   });
 *
 * After:
 *   router.get('/items', asyncHandler(async (req, res) => { ... }));
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ── 404 handler ───────────────────────────────────────────────────────────────

/**
 * Mount AFTER all routes.  Converts unmatched requests into a structured 404
 * so the errorHandler below formats them like every other error response.
 */
const notFoundHandler = (req, res, next) => {
  next(new AppError(
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    'NOT_FOUND',
  ));
};

// ── Global error handler ──────────────────────────────────────────────────────

// Map Postgres/Supabase error codes → user-friendly messages
const PG_ERROR_MAP = {
  '23505': { message: 'A record with those details already exists.',  code: 'DUPLICATE'         },
  '23503': { message: 'Referenced record does not exist.',            code: 'INVALID_REFERENCE' },
  '23502': { message: 'A required field is missing.',                 code: 'MISSING_FIELD'     },
  '22P02': { message: 'Invalid value format.',                        code: 'INVALID_FORMAT'    },
  'PGRST116': { message: 'Record not found.',                         code: 'NOT_FOUND'         },
};

/**
 * Express global error handler (4-argument signature is required).
 *
 * Rules:
 *  - 4xx errors always show the message to the client (operational / client fault).
 *  - 5xx errors show the message in development only; hide in production.
 *  - Stack trace is included only in development and only for 5xx.
 *  - If headers were already sent (streaming), delegates to Express default.
 */
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const isProd     = process.env.NODE_ENV === 'production';
  const statusCode = err.statusCode || err.status || 500;
  const isClient   = statusCode >= 400 && statusCode < 500;

  // Resolve message and code — Postgres errors need a translation step
  let { message, code } = err;
  const pgMapping = err.code ? PG_ERROR_MAP[err.code] : null;
  if (pgMapping) {
    message = pgMapping.message;
    code    = pgMapping.code;
  }
  code = code || null;

  // Log — errors ≥500 get full stack in dev; warnings for 4xx
  const prefix = `[${statusCode}] ${req.method} ${req.originalUrl}`;
  if (statusCode >= 500) {
    console.error(`${prefix} — ${message}`);
    if (!isProd) console.error(err.stack);
  } else {
    console.warn(`${prefix} — ${message}`);
  }

  // Safe message: 4xx always visible; 5xx hidden in production
  const clientMessage = isClient || !isProd
    ? message
    : 'Something went wrong on our end. Please try again.';

  res.status(statusCode).json({
    success: false,
    error: {
      message: clientMessage,
      status:  statusCode,
      ...(code                   ? { code }            : {}),
      ...(statusCode >= 500 && !isProd ? { stack: err.stack } : {}),
    },
  });
};

module.exports = { AppError, asyncHandler, notFoundHandler, errorHandler };
