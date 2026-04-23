const router = require('express').Router();
const ctrl = require('../controllers/productController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', ctrl.list);
router.get('/mine', requireAuth, requireRole('seller', 'admin'), ctrl.mine);
router.get('/:id', ctrl.getById);
router.post('/', requireAuth, requireRole('seller', 'admin'), ctrl.create);
router.patch('/:id', requireAuth, ctrl.update);
router.delete('/:id', requireAuth, ctrl.remove);

module.exports = router;
