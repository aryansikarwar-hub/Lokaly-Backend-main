const crypto = require('crypto');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const env = require('../config/env');
const { client, isConfigured } = require('../config/razorpay');

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
  // Without this, a duplicate verify call would deduct coins twice.
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
  // This way if coin deduction fails, the order is still marked paid (no money lost).
  // We can fix coin issues later via admin tools rather than fail the whole payment.
  await order.save();

  // ─── 3. Deduct redeemed coins via ledger ───────────────────────────────
  if (order.coinsRedeemed && order.coinsRedeemed > 0) {
    try {
      const User = require("../models/User");
      const { award } = require("../services/coinsService");

      // Defensive re-check: did the user still have enough coins at payment time?
      // (Prevents over-redemption if user redeemed across multiple pending orders.)
      const freshUser = await User.findById(order.buyer);
      const available = freshUser?.coins || 0;
      const toDeduct = Math.min(order.coinsRedeemed, available);

      if (toDeduct < order.coinsRedeemed) {
        // User redeemed more than they currently have. Cap to available and log.
        // eslint-disable-next-line no-console
        console.warn(
          `[payments.verify] coin shortfall on order ${order._id}: ` +
            `requested ${order.coinsRedeemed}, available ${available}, deducting ${toDeduct}`,
        );
        // Update the order to reflect actual deduction so refund logic stays accurate.
        order.coinsRedeemed = toDeduct;
        await order.save();
      }

      if (toDeduct > 0) {
        await award(order.buyer, -toDeduct, "order_redeem", {
          orderId: order._id,
          orderTotal: order.total,
        });
      }
    } catch (err) {
      // Log loudly but don't fail the payment — order is already paid.
      // eslint-disable-next-line no-console
      console.error(
        `[payments.verify] coin deduction failed for order ${order._id}:`,
        err.message,
      );
    }
  }

  // ─── 4. Clear cart once paid ───────────────────────────────────────────
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
