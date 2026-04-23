const router = require('express').Router();
const ctrl = require('../controllers/cartController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/', ctrl.get);
router.post('/add', ctrl.add);
router.patch('/update', ctrl.updateQty);
router.delete('/item/:productId', ctrl.remove);
router.delete('/clear', ctrl.clear);

module.exports = router;
