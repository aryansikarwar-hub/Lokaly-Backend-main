const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { cloudinary, isConfigured } = require('../config/cloudinary');

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

function makeStorage() {
  if (isConfigured) {
    return new CloudinaryStorage({
      cloudinary,
      params: (req, file) => ({
        folder: `lokaly/${req.user?._id || 'public'}`,
        resource_type: file.mimetype.startsWith('video') ? 'video' : 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov'],
        transformation: file.mimetype.startsWith('image')
          ? [{ quality: 'auto:good', fetch_format: 'auto' }]
          : undefined,
      }),
    });
  }
  // Local fallback for dev without Cloudinary creds.
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-z0-9_.-]/gi, '_');
      cb(null, `${Date.now()}_${safe}`);
    },
  });
}

const upload = multer({
  storage: makeStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const allowed = /image\/(png|jpe?g|webp)|video\/(mp4|quicktime)/;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  },
});

function toPublicUrl(file) {
  if (!file) return null;
  if (file.path && file.path.startsWith('http')) {
    return { url: file.path, publicId: file.filename };
  }
  return { url: `/uploads/${file.filename}`, publicId: file.filename };
}

module.exports = { upload, toPublicUrl, UPLOAD_ROOT };
