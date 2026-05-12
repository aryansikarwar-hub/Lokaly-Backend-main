// routes/upload.js
const express = require("express");
const path = require("path");
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
});

module.exports = router;
