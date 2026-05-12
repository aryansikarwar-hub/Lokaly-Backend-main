// backend/routes/uploadRoutes.js
// =====================================================
// Cloudinary-based upload route
// - Single:   POST /api/upload         (field: "file")
// - Multiple: POST /api/upload/multi   (field: "files")
// - Uses memory storage → streams to Cloudinary
// - Returns permanent CDN URLs (NOT ephemeral local paths)
// =====================================================

const express = require("express");
const multer = require("multer");
const streamifier = require("streamifier");

const { cloudinary, isConfigured } = require("../config/cloudinary");

const router = express.Router();

// =====================================================
// Multer (memory storage — no disk writes)
// =====================================================

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 150 * 1024 * 1024, // 150 MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|mp4|mov|webm|avi|mkv|m4v/i;
    const ok =
      allowed.test(file.mimetype) ||
      allowed.test((file.originalname || "").split(".").pop());
    if (ok) return cb(null, true);
    cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

// =====================================================
// Cloudinary stream upload helper
// =====================================================

function uploadBufferToCloudinary(buffer, { folder, resourceType }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType, // "image" | "video"
        // optimisations for images — Cloudinary auto picks best format/quality
        ...(resourceType === "image" && {
          transformation: [{ quality: "auto", fetch_format: "auto" }],
        }),
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

function detectKind(mimetype = "") {
  return mimetype.startsWith("video/") ? "video" : "image";
}

// =====================================================
// SINGLE FILE — POST /api/upload  (field "file")
// =====================================================

router.post("/", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    try {
      if (err) {
        console.error("[UPLOAD] multer error:", err.message);
        return res.status(400).json({ error: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      if (!isConfigured) {
        console.error("[UPLOAD] Cloudinary not configured");
        return res.status(500).json({
          error:
            "Storage not configured. Set CLOUDINARY_* env vars on the server.",
        });
      }

      const kind = detectKind(req.file.mimetype);
      const result = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "lokaly/products",
        resourceType: kind,
      });

      return res.json({
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        kind,
        size: req.file.size,
        width: result.width,
        height: result.height,
      });
    } catch (e) {
      console.error("[UPLOAD] failed:", e);
      return res
        .status(500)
        .json({ error: e.message || "Upload failed" });
    }
  });
});

// =====================================================
// MULTI FILE — POST /api/upload/multi  (field "files")
// =====================================================

router.post("/multi", (req, res) => {
  upload.array("files", 10)(req, res, async (err) => {
    try {
      if (err) {
        console.error("[UPLOAD/multi] multer error:", err.message);
        return res.status(400).json({ error: err.message });
      }

      if (!req.files || !req.files.length) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      if (!isConfigured) {
        console.error("[UPLOAD/multi] Cloudinary not configured");
        return res.status(500).json({
          error:
            "Storage not configured. Set CLOUDINARY_* env vars on the server.",
        });
      }

      const uploaded = await Promise.all(
        req.files.map(async (file) => {
          const kind = detectKind(file.mimetype);
          const result = await uploadBufferToCloudinary(file.buffer, {
            folder: "lokaly/products",
            resourceType: kind,
          });
          return {
            url: result.secure_url,
            publicId: result.public_id,
            kind,
            size: file.size,
            width: result.width,
            height: result.height,
          };
        })
      );

      return res.json({ success: true, files: uploaded });
    } catch (e) {
      console.error("[UPLOAD/multi] failed:", e);
      return res
        .status(500)
        .json({ error: e.message || "Upload failed" });
    }
  });
});

module.exports = router;