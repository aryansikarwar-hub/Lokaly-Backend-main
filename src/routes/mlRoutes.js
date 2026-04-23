const router = require('express').Router();
const ctrl = require('../controllers/mlController');
const { requireAuth } = require('../middleware/auth');

router.get('/health', ctrl.health);
router.get('/sentiment', ctrl.sentiment);
router.post('/sentiment', ctrl.sentiment);
router.post('/embed', ctrl.embed);
router.post('/search', ctrl.search);
router.get('/search', ctrl.search);
router.post('/reindex', requireAuth, ctrl.reindex);

module.exports = router;
