const router = require('express').Router();
const ctrl = require('../controllers/postController');
const { requireAuth } = require('../middleware/auth');

router.get('/', ctrl.feed);
router.post('/', requireAuth, ctrl.create);
router.get('/:id', ctrl.getById);
router.post('/:id/like', requireAuth, ctrl.like);
router.post('/:id/comment', requireAuth, ctrl.comment);
router.post('/:id/share', ctrl.share);
router.delete('/:id', requireAuth, ctrl.remove);

module.exports = router;
