const router = require('express').Router();
const { upload, toPublicUrl } = require('../middleware/upload');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

router.post(
  '/image',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    res.status(201).json(toPublicUrl(req.file));
  })
);

router.post(
  '/images',
  requireAuth,
  upload.array('files', 8),
  asyncHandler(async (req, res) => {
    const files = (req.files || []).map(toPublicUrl);
    res.status(201).json({ files });
  })
);

router.post(
  '/video',
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    res.status(201).json(toPublicUrl(req.file));
  })
);

module.exports = router;
