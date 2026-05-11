const router = require('express').Router();
const ctrl = require('../controllers/productController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload } = require("../middleware/upload");

router.get('/', ctrl.list);
router.get('/mine', requireAuth, requireRole('seller', 'admin'), ctrl.mine);
router.get('/:id', ctrl.getById);
router.post(
  "/",
  requireAuth,
  requireRole("seller", "admin"),
  upload.array("images", 10),
  ctrl.create,
);
 
router.patch("/:id", requireAuth, upload.array("images", 10), ctrl.update);
router.delete('/:id', requireAuth, ctrl.remove);

module.exports = router;
