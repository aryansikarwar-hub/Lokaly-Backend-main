const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');  // Added explicit import

const env = require('./config/env');

const app = express();

// Fix proxy issue FIRST
app.set('trust proxy', 1);  // Trusts Render proxy[web:12]

app.use(helmet());
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    if (buf && buf.length) req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true }));
if (!env.isProd) app.use(morgan('dev'));

// Rate limit API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'lokaly-backend',
    env: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

// Root info
app.get('/', (_req, res) => {
  res.json({
    name: 'Lokaly API',
    version: '0.1.0',
    docs: '/docs/API.md',
  });
});

// Static uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ROUTES ✅
app.use('/api/agora', require("./routes/agora"));
app.use('/api/auth', require("./routes/auth"));   // ⭐ ADD THIS
app.use('/api', require('./routes'));

// Error handlers LAST
const { notFound, errorHandler } = require('./middleware/errorHandler');
app.use(notFound);
app.use(errorHandler);

module.exports = app;