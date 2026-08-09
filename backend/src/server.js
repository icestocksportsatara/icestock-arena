require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const logger = require('./utils/logger');
const { helmetConfig, generalLimiter, hppMiddleware, sanitizeBody, noStore } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/users.routes');
const geoRoutes = require('./routes/geo.routes');
const teamRoutes = require('./routes/teams.routes');
const playerRoutes = require('./routes/players.routes');
const tournamentRoutes = require('./routes/tournaments.routes');
const scoringRoutes = require('./routes/scoring.routes');
const scorecardRoutes = require('./routes/scorecards.routes');
const statsRoutes = require('./routes/stats.routes');
const subscriptionRoutes = require('./routes/subscriptions.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, '')) // trim whitespace and any trailing slash
  .filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});
app.set('io', io);

// ---- Core security & hygiene middleware ------------------------------------------------
app.set('trust proxy', 1); // needed for correct req.ip behind a reverse proxy / load balancer

app.use(helmetConfig);
app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server / health-check requests with no Origin header.
      if (!origin) return callback(null, true);
      const normalized = origin.trim().replace(/\/+$/, '');
      if (allowedOrigins.includes(normalized)) return callback(null, true);
      logger.warn('Blocked by CORS — origin not in CLIENT_URL', { origin, allowedOrigins });
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(hppMiddleware);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitizeBody);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', generalLimiter);

// ---- Health check ------------------------------------------------------------------------
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

/**
 * A plain-language self-check for non-developers debugging a deployment.
 * Visit https://your-backend-url/health/diagnostics in a browser — it never
 * exposes secret values, only whether each required piece is present and
 * whether the database is actually reachable right now.
 */
app.get('/health/diagnostics', async (req, res) => {
  const checks = {
    databaseUrlSet: Boolean(process.env.DATABASE_URL),
    jwtAccessSecretSet: Boolean(process.env.JWT_ACCESS_SECRET),
    jwtRefreshSecretSet: Boolean(process.env.JWT_REFRESH_SECRET),
    clientUrlConfigured: allowedOrigins,
    smtpConfigured: Boolean(process.env.SMTP_HOST),
    nodeEnv: process.env.NODE_ENV || 'not set',
  };
  try {
    const { pool } = require('./config/db');
    await pool.query('SELECT 1');
    checks.databaseReachable = true;
  } catch (err) {
    checks.databaseReachable = false;
    checks.databaseError = err.message;
  }
  const allGood = checks.databaseUrlSet && checks.jwtAccessSecretSet && checks.jwtRefreshSecretSet && checks.databaseReachable;
  res.status(allGood ? 200 : 500).json({ ok: allGood, checks });
});

// ---- Routes --------------------------------------------------------------------------------
app.use('/api/auth', noStore, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/scoring', scoringRoutes);
app.use('/api/scorecards', scorecardRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
// Public, unauthenticated live-scoreboard endpoints (spectator / big-screen use).
// A lighter rate limit applies since this may be hit by many concurrent viewers.
app.use('/api/public', publicRoutes);

app.use(notFound);
app.use(errorHandler);

// ---- Real-time live scoring (Socket.io) --------------------------------------------------
// Logged-in clients (referees, heads, admin, players) send their JWT access
// token and get a verified socket.user. Public scoreboard viewers (spectators,
// venue screens) connect with NO token at all — they're allowed on as
// anonymous, read-only listeners so the live-scoring display works without
// a login, exactly like the public REST endpoints under /api/public.
// Anonymous sockets can only ever *listen*; nothing in this codebase accepts
// a score write over the socket — all scoring goes through authenticated
// REST routes, and the server itself pushes updates into the room from there.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.user = null; // anonymous / public viewer
    return next();
  }
  try {
    socket.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    next();
  } catch (err) {
    next(new Error('Invalid or expired token.'));
  }
});

io.on('connection', (socket) => {
  socket.on('match:join', (matchId) => {
    if (typeof matchId === 'string') socket.join(`match:${matchId}`);
  });
  socket.on('match:leave', (matchId) => {
    if (typeof matchId === 'string') socket.leave(`match:${matchId}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`Icestock Platform API listening on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || reason });
});

module.exports = { app, server, io };
