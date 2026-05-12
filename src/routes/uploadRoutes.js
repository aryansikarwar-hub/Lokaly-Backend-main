const express = require("express");
const multer = require("multer");
const streamifier = require("streamifier");

const { cloudinary, isConfigured } = require("../config/cloudinary");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// =====================================================
// Multer (memory storage)
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
      allowed.test(file.originalname.toLowerCase());

    if (ok) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  },
});

// =====================================================
// Cloudinary Upload Helper
// =====================================================

function uploadBufferToCloudinary(buffer, { folder, resourceType }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        ...(resourceType === "image" && {
          transformation: [
            {
              quality: "auto",
              fetch_format: "auto",
            },
          ],
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
  return mimetype.startsWith("video/")
    ? "video"
    : "image";
}

// =====================================================
// SINGLE FILE UPLOAD
// POST /api/upload
// =====================================================

router.post(
  "/",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded",
        });
      }

      if (!isConfigured) {
        return res.status(500).json({
          error: "Cloudinary not configured",
        });
      }

      const kind = detectKind(req.file.mimetype);

      const result = await uploadBufferToCloudinary(
        req.file.buffer,
        {
          folder: "lokaly/products",
          resourceType: kind,
        }
      );

      return res.json({
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        kind,
        size: req.file.size,
        width: result.width || null,
        height: result.height || null,
        duration: result.duration || null,
      });
    } catch (e) {
      console.error("[UPLOAD ERROR]", e);

      return res.status(500).json({
        error: e.message || "Upload failed",
      });
    }
  }
);

// =====================================================
// MULTIPLE FILE UPLOAD
// POST /api/upload/multi
// =====================================================

router.post(
  "/multi",
  requireAuth,
  upload.array("files", 10),
  async (req, res) => {
    try {
      if (!req.files || !req.files.length) {
        return res.status(400).json({
          error: "No files uploaded",
        });
      }

      if (!isConfigured) {
        return res.status(500).json({
          error: "Cloudinary not configured",
        });
      }

      const uploaded = await Promise.all(
        req.files.map(async (file) => {
          const kind = detectKind(file.mimetype);

          const result =
            await uploadBufferToCloudinary(
              file.buffer,
              {
                folder: "lokaly/products",
                resourceType: kind,
              }
            );

          return {
            url: result.secure_url,
            publicId: result.public_id,
            kind,
            size: file.size,
            width: result.width || null,
            height: result.height || null,
            duration: result.duration || null,
          };
        })
      );

      return res.json({
        success: true,
        files: uploaded,
      });
    } catch (e) {
      console.error("[MULTI UPLOAD ERROR]", e);

      return res.status(500).json({
        error: e.message || "Upload failed",
      });
    }
  }
);

module.exports = router;