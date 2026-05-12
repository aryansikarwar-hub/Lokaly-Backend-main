
// src/routes/uploadRoutes.js

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// IMPORTANT
// Use your REAL auth middleware
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ============================================
// Upload directory
// ============================================
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ============================================
// Multer storage
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },

  filename: (req, file, cb) => {
    const hash = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname);

    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});

// ============================================
// Multer config
// ============================================
const upload = multer({
  storage,

  limits: {
    fileSize: 150 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|mp4|mov|webm|avi|mkv|m4v/i;

    const ok =
      allowed.test(file.mimetype) ||
      allowed.test(path.extname(file.originalname));

    if (ok) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  },
});

// ============================================
// Cloudinary (optional)
// ============================================
let cloudinary = null;

try {
  if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary = require("cloudinary").v2;

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    console.log("[Upload] Cloudinary enabled");
  }
} catch (e) {
  console.log("[Upload] Cloudinary SDK missing — using local storage");
}

// ============================================
// SINGLE FILE UPLOAD
// ============================================
router.post("/", requireAuth, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    try {
      if (err) {
        console.error("[Upload] Multer error:", err);

        return res.status(400).json({
          error: err.message,
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded",
        });
      }

      console.log("[Upload] User:", req.user?._id);
      console.log("[Upload] File:", req.file.originalname);

      const isVideo = req.file.mimetype.startsWith("video/");

      const kind = isVideo ? "video" : "image";

      // ============================================
      // CLOUDINARY
      // ============================================
      if (cloudinary) {
        console.log("[Upload] Uploading to Cloudinary...");

        const result = await cloudinary.uploader.upload(req.file.path, {
          resource_type: isVideo ? "video" : "image",
          folder: "feed",
          chunk_size: 6000000,
        });

        fs.unlink(req.file.path, () => {});

        return res.json({
          success: true,
          url: result.secure_url,
          publicId: result.public_id,
          kind,
          width: result.width,
          height: result.height,
          duration: result.duration,
        });
      }

      // ============================================
      // LOCAL STORAGE
      // ============================================
      const publicUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

      return res.json({
        success: true,
        url: publicUrl,
        filename: req.file.filename,
        kind,
        size: req.file.size,
      });
    } catch (e) {
      console.error("[Upload] ERROR:", e);

      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(500).json({
        error: e.message || "Upload failed",
      });
    }
  });
});

// ============================================
// MULTIPLE FILES
// ============================================
router.post(
  "/multi",
  requireAuth,
  upload.array("files", 10),
  async (req, res) => {
    try {
      if (!req.files?.length) {
        return res.status(400).json({
          error: "No files uploaded",
        });
      }

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

            return {
              url: r.secure_url,
              publicId: r.public_id,
              kind,
            };
          }

          return {
            url: `${req.protocol}://${req.get("host")}/uploads/${file.filename}`,
            filename: file.filename,
            kind,
          };
        })
      );

      return res.json({
        success: true,
        files: results,
      });
    } catch (e) {
      console.error("[Upload Multi] ERROR:", e);

      return res.status(500).json({
        error: e.message,
      });
    }
  }
);

module.exports = router;
