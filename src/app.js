const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');

const app = express();

app.use(helmet());
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({
  limit: '2mb',
  // Capture the raw body so webhook HMAC verification (e.g. Razorpay) can hash
  // the exact bytes the provider signed, not a re-serialised JSON.
  verify: (req, _res, buf) => {
    if (buf && buf.length) req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true }));
if (!env.isProd) app.use(morgan('dev'));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'lokaly-backend',
    env: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Lokaly API',
    version: '0.1.0',
    docs: '/docs/API.md',
  });
});

app.use('/uploads', express.static(require('path').join(process.cwd(), 'uploads')));
app.use('/api', require('./routes'));

const { notFound, errorHandler } = require('./middleware/errorHandler');
app.use(notFound);
app.use(errorHandler);

module.exports = app;
