const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');

const chatHandlers = require('./chatHandlers');
const liveHandlers = require('./liveHandlers');

// userId -> socketId registry (supports getUserSocket lookups)
const users = new Map();

let io;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function attachSockets(httpServer, app) {
  io = new Server(httpServer, {
    cors: { origin: env.clientUrl, credentials: true },
    pingInterval: 20000,
    pingTimeout: 25000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false,
    },
  });

  // ── Auth middleware ──────────────────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token || socket.handshake.query?.token;

      if (!token) return next(); // anonymous – auth-gated events reject below

      const payload = jwt.verify(token, env.jwt.secret);
      socket.userId = payload.sub;
      socket.role = payload.role;
      socket.join(`user:${payload.sub}`);
    } catch (err) {
      logger.warn('socket auth failed', err.message);
    }
    next();
  });

  // ── Connection ───────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(
      `socket connected ${socket.id} user=${socket.userId || 'anon'}`
    );

    // Auto-register JWT-authenticated users immediately on connect
    if (socket.userId) {
      users.set(socket.userId, socket.id);
    }

    // ── register event ──────────────────────────────────────────────────
    // Fallback for anonymous or non-JWT clients that self-identify later.
    // Authenticated sockets are already registered above; calling this
    // again is a harmless no-op for them.
    socket.on('register', (userId) => {
      if (!userId) return;
      const key = String(userId);
      users.set(key, socket.id);
      socket.join(`user:${key}`);
      logger.info(`socket registered userId=${userId} socketId=${socket.id}`);
    });

    // ── Disconnect ──────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.debug(`socket disconnected ${socket.id}: ${reason}`);

      // Clean up registry – only remove if this socket is still the current
      // one for the user (guards against a reconnect race).
      if (socket.userId && users.get(socket.userId) === socket.id) {
        users.delete(socket.userId);
      } else {
        // Sweep for anonymous / register-based entries
        for (const [key, value] of users.entries()) {
          if (value === socket.id) {
            users.delete(key);
            break;
          }
        }
      }
    });

    chatHandlers(io, socket);
    liveHandlers(io, socket);
  });

  app.set('io', io);
  return io;
}

// ---------------------------------------------------------------------------
// Helpers (mirrors the original initSocket module's public API)
// ---------------------------------------------------------------------------

/** Returns the Socket.IO server instance (throws if not yet initialised). */
const getIO = () => {
  if (!io) throw new Error('Socket.IO not initialised – call attachSockets() first');
  return io;
};

/** Returns the current socket ID for a given userId, or undefined. */
const getUserSocket = (userId) => users.get(String(userId));

// ---------------------------------------------------------------------------

module.exports = { attachSockets, getIO, getUserSocket };
