const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

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
// Multer
// ============================================

const upload = multer({
  storage,

  limits: {
    fileSize: 150 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const allowed =
      /jpeg|jpg|png|webp|gif|mp4|mov|webm|avi|mkv|m4v/i;

    const validMime = allowed.test(file.mimetype);

    const validExt = allowed.test(
      path.extname(file.originalname)
    );

    if (validMime || validExt) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type: ${file.mimetype}`
        )
      );
    }
  },
});

// ============================================
// SINGLE FILE
// ============================================

router.post("/", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    try {
      if (err) {
        console.log("[UPLOAD ERROR]", err);

        return res.status(400).json({
          error: err.message,
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded",
        });
      }

      const isVideo =
        req.file.mimetype.startsWith("video/");

      const kind = isVideo ? "video" : "image";

      const publicUrl =
        `${req.protocol}://${req.get("host")}` +
        `/uploads/${req.file.filename}`;

      return res.json({
        success: true,
        url: publicUrl,
        filename: req.file.filename,
        kind,
        size: req.file.size,
      });
    } catch (e) {
      console.log("[UPLOAD FAILED]", e);

      return res.status(500).json({
        error: "Upload failed",
      });
    }
  });
});

// ============================================
// MULTI FILE
// ============================================

router.post(
  "/multi",
  upload.array("files", 10),
  async (req, res) => {
    try {
      if (!req.files || !req.files.length) {
        return res.status(400).json({
          error: "No files uploaded",
        });
      }

      const files = req.files.map((file) => {
        const isVideo =
          file.mimetype.startsWith("video/");

        const kind = isVideo ? "video" : "image";

        return {
          url:
            `${req.protocol}://${req.get("host")}` +
            `/uploads/${file.filename}`,

          filename: file.filename,

          kind,
        };
      });

      return res.json({
        success: true,
        files,
      });
    } catch (e) {
      console.log("[MULTI UPLOAD ERROR]", e);

      return res.status(500).json({
        error: "Upload failed",
      });
    }
  }
);

module.exports = router;