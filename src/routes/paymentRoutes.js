const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentController');
const { requireAuth } = require('../middleware/auth');

router.post('/order/:orderId/razorpay', requireAuth, ctrl.createRazorpayOrder);
router.post('/verify', requireAuth, ctrl.verifyPayment);

module.exports = router;
