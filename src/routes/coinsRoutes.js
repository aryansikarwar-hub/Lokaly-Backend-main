const router = require('express').Router();
const ctrl = require('../controllers/coinsController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.get('/ledger', ctrl.myLedger);
router.post('/redeem', ctrl.redeem);
router.post('/expire', requireAdmin, ctrl.expire);

module.exports = router;
