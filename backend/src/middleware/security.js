const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const xss = require('xss');

/** Helmet with a strict CSP — no inline scripts, no unknown origins. */
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

/** General API rate limit — protects against brute force / scraping. */
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

/** Tighter limit specifically on the login endpoint to blunt credential stuffing. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '8', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again later.' },
});

/** Recursively strips XSS payloads from string fields in the request body. */
function sanitizeBody(req, res, next) {
  const clean = (obj) => {
    if (typeof obj === 'string') return xss(obj.trim());
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const key of Object.keys(obj)) out[key] = clean(obj[key]);
      return out;
    }
    return obj;
  };
  if (req.body) req.body = clean(req.body);
  next();
}

module.exports = { helmetConfig, generalLimiter, loginLimiter, hppMiddleware: hpp(), sanitizeBody };
