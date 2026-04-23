const router = require('express').Router();
const ctrl = require('../controllers/faqController');
const { requireAuth } = require('../middleware/auth');

router.get('/suggest', ctrl.suggest);
router.get('/flagged', requireAuth, ctrl.flaggedForSeller);

module.exports = router;
