const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path");

const env = require("./config/env");

const app = express();

app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// ✅ CORS: allow configured CLIENT_URL + localhost:5173 always
const allowedOrigins = [
  env.clientUrl,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, Postman, mobile apps
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

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "lokaly-backend",
    env: env.nodeEnv,
    timestamp: new Date().toISOString(),
  }),
);
app.get("/", (_req, res) => res.json({ name: "Lokaly API", version: "0.1.0" }));

// ✅ Static uploads with full CORS headers for video range requests
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");
const uploadCors = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length",
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
};
app.use("/uploads", uploadCors, express.static(UPLOAD_ROOT));
app.use("/api/uploads", uploadCors, express.static(UPLOAD_ROOT));

// ROUTES
app.use("/api/agora", require("./routes/agora"));
app.use("/api/recommendations", require("./routes/recommendations"));
app.use("/api", require("./routes"));

const { notFound, errorHandler } = require("./middleware/errorHandler");
app.use(notFound);
app.use(errorHandler);

module.exports = app;
