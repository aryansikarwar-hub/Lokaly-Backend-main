const mongoose = require('mongoose');
const env = require('./env');

let connectionPromise = null;

async function connectDB() {
  if (connectionPromise) return connectionPromise;
  mongoose.set('strictQuery', true);
  connectionPromise = mongoose
    .connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 })
    .then((conn) => {
      console.log(`[db] mongo connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn;
    })
    .catch((err) => {
      connectionPromise = null;
      console.error('[db] mongo connection failed:', err.message);
      throw err;
    });
  return connectionPromise;
}

async function disconnectDB() {
  if (!connectionPromise) return;
  await mongoose.disconnect();
  connectionPromise = null;
}

module.exports = { connectDB, disconnectDB, mongoose };
