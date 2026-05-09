const router = require('express').Router();
const ctrl = require('../controllers/authController');
const otpCtrl = require('../controllers/emailOtpController');
const { requireAuth } = require('../middleware/auth');

// Existing
router.post('/signup', ctrl.signup);
router.post('/login', ctrl.login);
router.post('/logout', requireAuth, ctrl.logout);
router.get('/me', requireAuth, ctrl.me);
router.patch('/me', requireAuth, ctrl.updateProfile);

// Existing — link-based verification (kept for back-compat)
router.post('/verify-email', ctrl.verifyEmail);
router.post('/resend-verification', requireAuth, ctrl.resendVerification);

// 🆕 OTP-based email verification
router.post('/email/send-otp',   requireAuth, otpCtrl.sendEmailOtp);
router.post('/email/verify-otp', requireAuth, otpCtrl.verifyEmailOtp);
router.get ('/email/otp-status', requireAuth, otpCtrl.getOtpStatus);

module.exports = router;