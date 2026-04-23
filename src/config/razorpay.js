const Razorpay = require('razorpay');
const env = require('./env');

const isConfigured = Boolean(env.razorpay.keyId && env.razorpay.keySecret);

const client = isConfigured
  ? new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret })
  : null;

module.exports = { client, isConfigured };
