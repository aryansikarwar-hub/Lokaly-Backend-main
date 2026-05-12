const router = require('express').Router();
const ctrl = require('../controllers/productController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload } = require("../middleware/upload");

// Public routes
router.get('/', ctrl.list);
router.get('/mine', requireAuth, requireRole('seller', 'admin'), ctrl.mine);
router.get('/:id', ctrl.getById);

// FIX: upload.array is kept for legacy multipart support,
// but the primary flow now uses JSON body with pre-uploaded Cloudinary URLs.
// upload.none() would reject JSON; upload.array() passes JSON through untouched.
router.post(
  "/",
  requireAuth,
  requireRole("seller", "admin"),
  upload.array("images", 10),
  ctrl.create,
);

router.patch(
  "/:id",
  requireAuth,
  upload.array("images", 10),
  ctrl.update,
);

router.delete('/:id', requireAuth, ctrl.remove);

module.exports = router;