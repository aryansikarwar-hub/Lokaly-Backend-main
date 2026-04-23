const router = require('express').Router();
const ctrl = require('../controllers/stressController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/mine', ctrl.mine);
router.get('/karma', ctrl.myKarma);

module.exports = router;
