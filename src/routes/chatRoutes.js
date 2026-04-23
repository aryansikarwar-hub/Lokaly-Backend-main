const router = require('express').Router();
const ctrl = require('../controllers/chatController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/conversations', ctrl.listConversations);
router.get('/conversations/with/:userId', ctrl.openWith);
router.get('/conversations/:conversationId/messages', ctrl.messages);
router.post('/conversations/:conversationId/messages', ctrl.send);

module.exports = router;
