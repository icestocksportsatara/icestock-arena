require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const logger = require('./utils/logger');
const { helmetConfig, generalLimiter, hppMiddleware, sanitizeBody } = require('./middleware/security');
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

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',');
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});
app.set('io', io);

// ---- Core security & hygiene middleware ------------------------------------------------
app.set('trust proxy', 1); // needed for correct req.ip behind a reverse proxy / load balancer
app.use(helmetConfig);
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(hppMiddleware);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitizeBody);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/api', generalLimiter);

// ---- Health check ------------------------------------------------------------------------
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ---- Routes --------------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/scoring', scoringRoutes);
app.use('/api/scorecards', scorecardRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);

app.use(notFound);
app.use(errorHandler);

// ---- Real-time live scoring (Socket.io) --------------------------------------------------
// Clients authenticate the socket with the same short-lived JWT access token
// used for REST calls, then join a room per match to receive live updates.
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required.'));
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    socket.user = payload;
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
