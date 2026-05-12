const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path");

const env = require("./config/env");

const app = express();

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