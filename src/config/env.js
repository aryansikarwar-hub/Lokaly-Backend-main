require('dotenv').config();

const DEFAULT_JWT_SECRET = 'dev_insecure_secret_change_me';

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lokaly',
  jwt: {
    secret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  agora: {
    appId: process.env.AGORA_APP_ID || '',
    appCert: process.env.AGORA_APP_CERT || '',
  },
};

env.isProd = env.nodeEnv === 'production';

{
  const secret = process.env.JWT_SECRET;
  const weak = !secret || secret === DEFAULT_JWT_SECRET;
  if (env.isProd) {
    if (weak || secret.length < 16) {
      throw new Error(
        '[lokaly] FATAL: JWT_SECRET is missing, too short, or set to the insecure ' +
        'default in production. Set a strong JWT_SECRET (>=16 chars).'
      );
    }
  } else if (weak) {
    // eslint-disable-next-line no-console
    console.error(
      '[lokaly] WARN: JWT_SECRET is missing or set to the insecure default. ' +
      'Set a strong JWT_SECRET before deploying to production.'
    );
  }
}

module.exports = env;
