const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const logger = require('./utils/logger');
const { attachSockets } = require('./sockets');

const server = http.createServer(app);
attachSockets(server, app);

(async () => {
  try {
    await connectDB();
  } catch (err) {
    logger.warn('API starting without MongoDB (will retry on first request).', err.message);
  }
  server.listen(env.port, () => {
    logger.info(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  // Recurring coin-expiry sweep — first run ~15s after boot, then every 24h.
  try {
    const { startCoinExpiryJob } = require('./services/coinsService');
    startCoinExpiryJob();
  } catch (err) {
    logger.warn('coin expiry job failed to start:', err.message);
  }
})();

const shutdown = (signal) => {
  console.log(`[lokaly] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
