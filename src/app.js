const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const _path = require("path");

const env = require("./config/env");

const app = express();

app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(cors({ origin: env.clientUrl, credentials: true }));

app.use(express.json({ limit: "50mb", verify: (req, _res, buf) => { if (buf?.length) req.rawBody = buf.toString("utf8"); } }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

if (!env.isProd) app.use(morgan("dev"));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);

app.use("/uploads", (req, res, next) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); next(); }, express.static(_path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => { res.json({ ok: true, service: "lokaly-backend", env: env.nodeEnv, timestamp: new Date().toISOString() }); });

app.get("/", (_req, res) => { res.json({ name: "Lokaly API", version: "1.0.0", status: "running" }); });

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/agora", require("./routes/agora"));
app.use("/api/recommendations", require("./routes/recommendations"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api", require("./routes"));

const { notFound, errorHandler } = require("./middleware/errorHandler");
app.use(notFound);
app.use(errorHandler);

module.exports = app;
