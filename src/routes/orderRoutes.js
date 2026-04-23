const router = require('express').Router();
const ctrl = require('../controllers/orderController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.post('/', ctrl.createFromCart);
router.get('/mine', ctrl.myOrders);
router.get('/seller', requireRole('seller', 'admin'), ctrl.sellerOrders);
router.get('/:id', ctrl.getById);
router.patch('/:id/status', ctrl.updateStatus);

module.exports = router;
