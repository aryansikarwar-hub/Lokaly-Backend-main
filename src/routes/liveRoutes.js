const router = require('express').Router();
const ctrl = require('../controllers/liveController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/sessions', ctrl.list);
router.get('/sessions/:id', ctrl.getById);
router.post('/sessions', requireAuth, requireRole('seller', 'admin'), ctrl.create);
router.post('/sessions/:id/start', requireAuth, ctrl.start);
router.post('/sessions/:id/end', requireAuth, ctrl.end);
router.post('/sessions/:id/flash-deal', requireAuth, ctrl.addFlashDeal);
router.post('/sessions/:id/flash-deal/:dealId/claim', requireAuth, ctrl.claimFlashDeal);
router.post('/sessions/:id/poll', requireAuth, ctrl.addPoll);
router.post('/sessions/:id/poll/:pollId/vote', requireAuth, ctrl.votePoll);
router.post('/sessions/:id/spin', requireAuth, ctrl.spin);
router.post('/sessions/:id/group-buy/join', requireAuth, ctrl.joinGroupBuy);

module.exports = router;
