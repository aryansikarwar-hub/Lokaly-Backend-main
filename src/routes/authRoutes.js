const router = require('express').Router();
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/signup', ctrl.signup);
router.post('/login', ctrl.login);
router.post('/logout', requireAuth, ctrl.logout);
router.get('/me', requireAuth, ctrl.me);
router.patch('/me', requireAuth, ctrl.updateProfile);
router.post('/verify-email', ctrl.verifyEmail);
router.post('/resend-verification', requireAuth, ctrl.resendVerification);

module.exports = router;
