const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');

const chatHandlers = require('./chatHandlers');
const liveHandlers = require('./liveHandlers');

function attachSockets(httpServer, app) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientUrl, credentials: true },
    pingInterval: 20000,
    pingTimeout: 25000,
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(); // allow anonymous for public live viewing, auth-gated events reject below.
      const payload = jwt.verify(token, env.jwt.secret);
      socket.userId = payload.sub;
      socket.role = payload.role;
      socket.join(`user:${payload.sub}`);
    } catch (err) {
      logger.warn('socket auth failed', err.message);
    }
    next();
  });

  io.on('connection', (socket) => {
    logger.info(`socket connected ${socket.id} user=${socket.userId || 'anon'}`);

    socket.on('disconnect', (reason) => {
      logger.debug(`socket disconnected ${socket.id}: ${reason}`);
    });

    chatHandlers(io, socket);
    liveHandlers(io, socket);
  });

  app.set('io', io);
  return io;
}

module.exports = { attachSockets };
