const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentController');
const { requireAuth } = require('../middleware/auth');

router.post('/order/:orderId/razorpay', requireAuth, ctrl.createRazorpayOrder);
router.post('/verify', requireAuth, ctrl.verifyPayment);

// Razorpay webhook — raw body required for HMAC signature verification.
// The app-level express.json middleware captures the exact bytes via its
// `verify` hook (see app.js) onto req.rawBody, which the controller hashes.
router.post('/webhook', ctrl.webhook);

module.exports = router;
