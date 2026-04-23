const router = require('express').Router();
const ctrl = require('../controllers/reviewController');
const { requireAuth } = require('../middleware/auth');

router.get('/product/:productId', ctrl.forProduct);
router.get('/seller/:userId', ctrl.forSeller);
router.post('/', requireAuth, ctrl.create);
router.post('/:id/helpful', requireAuth, ctrl.voteHelpful);

module.exports = router;
