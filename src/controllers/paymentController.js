const crypto = require('crypto');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const { client, isConfigured } = require('../config/razorpay');
const { createAndEmitNotification } = require('../services/notificationService');

exports.createRazorpayOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (String(order.buyer) !== String(req.user._id)) throw ApiError.forbidden();
  if (order.status !== 'pending') throw ApiError.badRequest('Order already processed');

  if (!isConfigured) {
    // Dev fallback: simulate a Razorpay order so frontend flow still works in demo without real keys.
    const fakeId = `order_dev_${order._id}`;
    order.payment.orderId = fakeId;
    order.payment.provider = 'razorpay-mock';
    await order.save();
    return res.json({
      razorpayOrderId: fakeId,
      amount: order.total * 100,
      currency: order.currency,
      key: 'rzp_test_dev_mock',
      mock: true,
    });
  }

  const rp = await client.orders.create({
    amount: Math.round(order.total * 100),
    currency: order.currency,
    receipt: String(order._id),
    notes: { buyer: String(order.buyer) },
  });

  order.payment.orderId = rp.id;
  await order.save();

  res.json({
    razorpayOrderId: rp.id,
    amount: rp.amount,
    currency: rp.currency,
    key: env.razorpay.keyId,
  });
});

exports.verifyPayment = asyncHandler(async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    orderId,
  } = req.body || {};
  if (!orderId) throw ApiError.badRequest("orderId required");

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Order not found");
  if (String(order.buyer) !== String(req.user._id)) throw ApiError.forbidden();

  // Idempotency guard: don't re-process an already-paid order.
  if (order.payment?.paidAt) {
    return res.json({ ok: true, order, alreadyPaid: true });
  }

  // ─── 1. Verify the payment (mock or real) ──────────────────────────────
  if (!isConfigured) {
    // Dev mock path: trust the client, mark as paid.
    order.payment = {
      ...(order.payment.toObject?.() || order.payment),
      paymentId: razorpay_payment_id || `pay_dev_${Date.now()}`,
      signature: "mock",
      paidAt: new Date(),
      mode: "mock",
    };
    order.addTimeline(
      "paid",
      "Mock payment accepted (no Razorpay keys configured)",
    );
  } else {
    // Real Razorpay path: verify signature.
    const expected = crypto
      .createHmac("sha256", env.razorpay.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      throw ApiError.badRequest("Invalid payment signature");
    }

    order.payment.paymentId = razorpay_payment_id;
    order.payment.signature = razorpay_signature;
    order.payment.paidAt = new Date();
    order.addTimeline("paid", "Payment verified via Razorpay");
  }

  // ─── 2. Save the paid order BEFORE deducting coins ─────────────────────
  // If coin deduction fails afterward, the order is still marked paid.
  await order.save();

  // ─── 3. Deduct redeemed coins via ledger (runs for BOTH mock and real) ─
  if (order.coinsRedeemed && order.coinsRedeemed > 0) {
    try {
      const User = require("../models/User");
      const { award } = require("../services/coinsService");

      const freshUser = await User.findById(order.buyer);
      const available = freshUser?.coins || 0;
      const toDeduct = Math.min(order.coinsRedeemed, available);

      if (toDeduct < order.coinsRedeemed) {
        // eslint-disable-next-line no-console
        console.warn(
          `[payments.verify] coin shortfall on order ${order._id}: ` +
            `requested ${order.coinsRedeemed}, available ${available}, deducting ${toDeduct}`,
        );
        order.coinsRedeemed = toDeduct;
        await order.save();
      }

      if (toDeduct > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `🪙 [payments.verify] deducting ${toDeduct} coins from user ${order.buyer} for order ${order._id}`,
        );
        await award(order.buyer, -toDeduct, "order_redeem", {
          orderId: order._id,
          orderTotal: order.total,
        });
        // eslint-disable-next-line no-console
        console.log(
          `🪙 [payments.verify] coin deduction successful for order ${order._id}`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[payments.verify] coin deduction failed for order ${order._id}:`,
        err.message,
      );
    }
  }

  // ─── 4. Notify the buyer ───────────────────────────────────────────────
  await createAndEmitNotification({
    userId: order.buyer,
    type: "order",
    message: `Payment received for order #${order._id}`,
    orderId: order._id,
  });

  // ─── 5. Clear cart once paid ───────────────────────────────────────────
  try {
    const Cart = require("../models/Cart");
    await Cart.updateOne({ user: order.buyer }, { $set: { items: [] } });
  } catch (_) {
    /* non-fatal */
  }

  res.json({ ok: true, order, mock: !isConfigured });
});

exports.webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const secret = env.razorpay.webhookSecret;

  // Require a configured secret + signed header before doing any work.
  if (!secret) {
    // eslint-disable-next-line no-console
    console.error('[razorpay webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    return res.status(400).json({ error: 'webhook not configured' });
  }
  if (!signature) {
    return res.status(400).json({ error: 'missing signature' });
  }

  // HMAC over the exact bytes Razorpay signed. app.js captures req.rawBody via
  // the express.json `verify` hook; fall back to a canonical stringify only as
  // a last resort (never reaches prod if raw body is captured).
  const bodyStr = typeof req.rawBody === 'string' && req.rawBody.length
    ? req.rawBody
    : JSON.stringify(req.body || {});

  let valid = false;
  try {
    const expected = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    valid = false;
  }

  if (!valid) {
    return res.status(400).json({ error: 'invalid signature' });
  }

  const event = req.body?.event;
  const payload = req.body?.payload;
  // eslint-disable-next-line no-console
  console.log('[razorpay webhook]', {
    event,
    paymentId: payload?.payment?.entity?.id,
  });

  res.json({ received: true });
});
