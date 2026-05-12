const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path"); // Added explicit import
const path = require("path");

const env = require("./config/env");

const app = express();

// Fix proxy issue FIRST
app.set("trust proxy", 1); // Trusts Render proxy[web:12]
// ============================================
// TRUST PROXY
// ============================================
app.set("trust proxy", 1);

// ============================================
// SECURITY
// ============================================
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);
// Allow configured CLIENT_URL + localhost:5173 in dev
const allowedOrigins = [
  env.clientUrl,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow no-origin requests (mobile apps, Postman, curl)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS: origin not allowed: " + origin));
    },
    credentials: true,
  }),
);
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      if (buf && buf.length) req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
if (!env.isProd) app.use(morgan("dev"));

// ============================================
// CORS
// ============================================
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  })
);

// ============================================
// BODY PARSER
// ============================================
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      if (buf?.length) {
        req.rawBody = buf.toString("utf8");
      }
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb",
  })
);

// ============================================
// LOGGER
// ============================================
if (!env.isProd) {
  app.use(morgan("dev"));
}

// ============================================
// RATE LIMIT
// ============================================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

// Health check

app.use("/api", apiLimiter);

// ============================================
// STATIC UPLOADS
// ============================================
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader(
      "Cross-Origin-Resource-Policy",
      "cross-origin"
    );

    next();
  },
  express.static(path.join(process.cwd(), "uploads"))
);

// ============================================
// HEALTH CHECK
// ============================================
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "lokaly-backend",
    env: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

// Root info
app.get("/", (_req, res) => {
  res.json({
    name: "Lokaly API",
    version: "0.1.0",
    docs: "/docs/API.md",
// ============================================
// ROOT
// ============================================
app.get("/", (_req, res) => {
  res.json({
    name: "Lokaly API",
    version: "1.0.0",
    status: "running",
  });
});

// ============================================
// ROUTES
// ============================================

// AUTH
app.use("/api/auth", require("./routes/authRoutes"));

// UPLOAD
app.use("/api/upload", require("./routes/uploadRoutes"));

// AGORA
app.use("/api/agora", require("./routes/agora"));

// RECOMMENDATIONS
app.use(
  "/api/recommendations",
  require("./routes/recommendations")
);

// ROUTES ✅
app.use("/api/agora", require("./routes/agora"));
app.use("/api/recommendations", require("./routes/recommendations"));
//app.use('/api/auth', require("./routes/auth"));   // ⭐ ADD THIS
app.use("/api", require("./routes"));

// Error handlers LAST
const { notFound, errorHandler } = require("./middleware/errorHandler");
app.use(notFound);
app.use(errorHandler);

module.exports = app;
// ALL ROUTES
app.use("/api", require("./routes"));

// ============================================
// ERROR HANDLER
// ============================================
const {
  notFound,
  errorHandler,
} = require("./middleware/errorHandler");

app.use(notFound);
app.use(errorHandler);

// ============================================
// EXPORT
// ============================================
module.exports = app;
