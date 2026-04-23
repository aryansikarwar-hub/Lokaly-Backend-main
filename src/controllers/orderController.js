const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

exports.createFromCart = asyncHandler(async (req, res) => {
  const { address, coinsToRedeem = 0 } = req.body || {};
  if (!address) throw ApiError.badRequest('address required');

  const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
  if (!cart || cart.items.length === 0) throw ApiError.badRequest('Cart is empty');

  const items = [];
  let subtotal = 0;
  for (const it of cart.items) {
    const p = it.product;
    if (!p || !p.isActive) throw ApiError.badRequest(`Product unavailable`);
    const price = p.price;
    subtotal += price * it.quantity;
    items.push({
      product: p._id,
      seller: p.seller,
      title: p.title,
      image: p.images?.[0]?.url,
      quantity: it.quantity,
      price,
    });
  }

  // Atomically decrement stock using a stock >= qty pre-check. If any item fails,
  // rollback prior decrements and return 409.
  const decremented = [];
  for (const it of items) {
    const r = await Product.updateOne(
      { _id: it.product, isActive: true, stock: { $gte: it.quantity } },
      { $inc: { stock: -it.quantity } }
    );
    if (r.modifiedCount !== 1) {
      // Rollback previously decremented items.
      for (const d of decremented) {
        await Product.updateOne({ _id: d.product }, { $inc: { stock: d.quantity } });
      }
      throw new ApiError(409, `Out of stock: ${it.title}`);
    }
    decremented.push(it);
  }

  const usableCoins = Math.min(
    parseInt(coinsToRedeem, 10) || 0,
    req.user.coins || 0,
    Math.floor(subtotal * 0.2) // cap coin redemption at 20% of subtotal (1 coin = ₹1)
  );
  const shipping = subtotal > 999 ? 0 : 49;
  const total = subtotal + shipping - usableCoins;

  let order;
  try {
    order = await Order.create({
      buyer: req.user._id,
      items,
      address,
      subtotal,
      shipping,
      coinsRedeemed: usableCoins,
      total,
      timeline: [{ status: 'pending', note: 'Order created, awaiting payment' }],
    });
  } catch (err) {
    // Order persist failed — undo stock decrements.
    for (const d of decremented) {
      await Product.updateOne({ _id: d.product }, { $inc: { stock: d.quantity } });
    }
    throw err;
  }

  if (usableCoins > 0) {
    req.user.coins -= usableCoins;
    await req.user.save();
  }

  res.status(201).json({ order });
});

exports.myOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ buyer: req.user._id })
    .sort({ createdAt: -1 })
    .populate('items.product', 'title images slug');
  res.json({ orders });
});

exports.sellerOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ 'items.seller': req.user._id })
    .sort({ createdAt: -1 })
    .populate('buyer', 'name email');
  res.json({ orders });
});

exports.getById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('items.product', 'title images slug')
    .populate('buyer', 'name email');
  if (!order) throw ApiError.notFound('Order not found');
  const isOwner = String(order.buyer._id) === String(req.user._id);
  const isSeller = order.items.some((i) => String(i.seller) === String(req.user._id));
  if (!isOwner && !isSeller && req.user.role !== 'admin') throw ApiError.forbidden();
  res.json({ order });
});

exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body || {};
  if (!Order.STATUS.includes(status)) throw ApiError.badRequest('Invalid status');
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  const isSeller = order.items.some((i) => String(i.seller) === String(req.user._id));
  const isBuyer = String(order.buyer) === String(req.user._id);
  if (!isSeller && !isBuyer && req.user.role !== 'admin') throw ApiError.forbidden();

  const prevStatus = order.status;
  order.addTimeline(status, note);

  // On cancel / refund — restore the stock that was reserved at creation-time.
  if ((status === 'cancelled' || status === 'refunded') &&
      prevStatus !== 'cancelled' && prevStatus !== 'refunded') {
    for (const it of order.items) {
      await Product.updateOne({ _id: it.product }, { $inc: { stock: it.quantity } });
    }
    if (order.coinsRedeemed && order.coinsRedeemed > 0) {
      try {
        const { award } = require('../services/coinsService');
        await award(order.buyer, order.coinsRedeemed, 'admin_adjust', {
          orderId: order._id, reason: 'refund-redeemed-coins',
        });
      } catch (_) { /* non-fatal */ }
    }
  }

  if (status === 'delivered') {
    // Stock was already decremented at order creation; only bump sales counts here.
    for (const it of order.items) {
      await Product.updateOne(
        { _id: it.product },
        { $inc: { salesCount: it.quantity } }
      );
    }
    const reward = Math.max(5, Math.floor(order.subtotal * 0.01));
    try {
      const { award } = require('../services/coinsService');
      await award(order.buyer, reward, 'order_reward', { orderId: order._id });
    } catch (_) { /* non-fatal */ }

    // Accrue GMV per seller for referral tracking + lifetime 2% cashback.
    try {
      const { recordSellerSale } = require('../services/referralService');
      const bySeller = order.items.reduce((acc, it) => {
        const k = String(it.seller);
        acc[k] = (acc[k] || 0) + it.price * it.quantity;
        return acc;
      }, {});
      for (const [sellerId, amount] of Object.entries(bySeller)) {
        await recordSellerSale(sellerId, amount);
      }
    } catch (_) { /* non-fatal */ }
  }

  await order.save();
  res.json({ order });
});
