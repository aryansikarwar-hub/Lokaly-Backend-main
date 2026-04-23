const router = require('express').Router();
const ctrl = require('../controllers/trustController');

router.get('/:userId', ctrl.get);

module.exports = router;
