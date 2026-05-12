// routes/upload.js
const express = require("express");
const path = require("path");
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

// ✅ Real JWT auth
const { requireAuth } = require("../middleware/auth");

// ✅ Use the shared upload middleware (correct UPLOAD_ROOT path)
const { upload, toPublicUrl } = require("../middleware/upload");

// ============ SINGLE FILE UPLOAD ============
router.post("/", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Koi file nahi mili" });

  const isVideo = req.file.mimetype.startsWith("video/");
  const kind = isVideo ? "video" : "image";
  const { url, publicId } = toPublicUrl(req.file);

  console.log("[Upload] Success:", url, kind);

  return res.json({
    url,
    publicId: publicId || "",
    kind,
    filename: req.file.filename,
    size: req.file.size,
    width: req.file.width || null,
    height: req.file.height || null,
    duration: req.file.duration || null,
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
      allowed.test(path.extname(file.originalname));
    if (ok) cb(null, true);
    else cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

// ============ OPTIONAL: Cloudinary ============
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
  console.log("[Upload] Cloudinary SDK not installed — using local storage");
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

    console.log(
      "[Upload] File received:",
      req.file.originalname,
      req.file.size,
      "bytes",
    );
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

      // ===== Option B: Serve from local =====
      // Make sure your Express app serves /uploads statically:
      // app.use("/uploads", express.static(path.join(__dirname, "uploads")));
      // Use relative URL so it works via Vite proxy in dev and real domain in prod
      const publicUrl = `/uploads/${req.file.filename}`;
      console.log("[Upload] Local saved:", publicUrl);
      res.json({
        url: publicUrl,
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

// ============ MULTIPLE FILES ============
router.post("/multi", requireAuth, upload.array("files", 10), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "No files" });

  const results = req.files.map((file) => {
    const isVideo = file.mimetype.startsWith("video/");
    const { url, publicId } = toPublicUrl(file);
    return { url, publicId: publicId || "", kind: isVideo ? "video" : "image" };
  });

  return res.json({ files: results });
          if (cloudinary) {
            const r = await cloudinary.uploader.upload(file.path, {
              resource_type: isVideo ? "video" : "image",
              folder: "feed",
            });
            fs.unlink(file.path, () => {});
            return { url: r.secure_url, publicId: r.public_id, kind };
          }
          return {
            url: `/uploads/${file.filename}`,
            kind,
            filename: file.filename,
          };
        }),
      );
      res.json({ files: results });
    } catch (e) {
      console.error("[Upload Multi] error:", e);
      res.status(500).json({ error: e.message });
    }
  },
);
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
