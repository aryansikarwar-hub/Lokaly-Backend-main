// routes/upload.js
// Universal file upload endpoint
// Supports: local disk, Cloudinary

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const router = express.Router();

// ============ AUTH MIDDLEWARE ============
// Replace with your actual auth
const requireAuth = (req, res, next) => {
  if (!req.user?._id) return res.status(401).json({ error: "Login required" });
  next();
};

// ============ MULTER CONFIG ============
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const hash = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB max
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|mp4|mov|webm|avi|mkv|m4v/i;
    const ok = allowed.test(file.mimetype) || allowed.test(path.extname(file.originalname));
    if (ok) cb(null, true);
    else cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

// ============ OPTIONAL: Cloudinary ============
let cloudinary = null;
try {
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log("[Upload] Cloudinary enabled");
  }
} catch (e) {
  console.log("[Upload] Cloudinary SDK not installed — using local storage");
}

// ============ UPLOAD ENDPOINT ============
router.post("/", requireAuth, (req, res, next) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      console.error("[Upload] Multer error:", err);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Koi file nahi mili" });
    }

    console.log("[Upload] File received:", req.file.originalname, req.file.size, "bytes");

    try {
      const isVideo = req.file.mimetype.startsWith("video/");
      const kind = isVideo ? "video" : "image";

      // ===== Option A: Cloudinary =====
      if (cloudinary) {
        console.log("[Upload] Uploading to Cloudinary...");
        const result = await cloudinary.uploader.upload(req.file.path, {
          resource_type: isVideo ? "video" : "image",
          folder: "feed",
          chunk_size: 6000000, // 6MB chunks for big videos
        });
        // Delete local temp file
        fs.unlink(req.file.path, () => {});
        console.log("[Upload] Cloudinary done:", result.secure_url);
        return res.json({
          url: result.secure_url,
          publicId: result.public_id,
          kind,
          width: result.width,
          height: result.height,
          duration: result.duration,
        });
      }

      // ===== Option B: Serve from local =====
      // Make sure your Express app serves /uploads statically:
      // app.use("/uploads", express.static(path.join(__dirname, "uploads")));
      const publicUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
      console.log("[Upload] Local saved:", publicUrl);
      res.json({
        url: publicUrl,
        kind,
        filename: req.file.filename,
        size: req.file.size,
      });
    } catch (e) {
      console.error("[Upload] Process error:", e);
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      res.status(500).json({ error: e.message || "Upload fail" });
    }
  });
});

// ============ MULTIPLE FILES ============
router.post("/multi", requireAuth, upload.array("files", 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "No files" });

  try {
    const results = await Promise.all(
      req.files.map(async (file) => {
        const isVideo = file.mimetype.startsWith("video/");
        const kind = isVideo ? "video" : "image";

        if (cloudinary) {
          const r = await cloudinary.uploader.upload(file.path, {
            resource_type: isVideo ? "video" : "image",
            folder: "feed",
          });
          fs.unlink(file.path, () => {});
          return { url: r.secure_url, publicId: r.public_id, kind };
        }
        return {
          url: `${req.protocol}://${req.get("host")}/uploads/${file.filename}`,
          kind,
          filename: file.filename,
        };
      })
    );
    res.json({ files: results });
  } catch (e) {
    console.error("[Upload Multi] error:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;