const router = require('express').Router();
const ctrl = require('../controllers/referralController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/dashboard', ctrl.myDashboard);

module.exports = router;
