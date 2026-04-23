const Order = require('../models/Order');
const Product = require('../models/Product');
const Message = require('../models/Message');

/**
 * Seller Stress Radar — detects struggling sellers.
 *
 * Signals:
 *  - unfulfilled orders older than 48h
 *  - repeat stockouts (products with stock=0 but active)
 *  - slow chat response time (avg reply latency to inbound buyer DMs in last 7d)
 *  - cancellation spike (>20% last 14 days)
 *
 * Each signal contributes to a 0..100 stress score; high score -> trigger coaching notification.
 */
async function computeStress(sellerId) {
  const signals = [];
  const now = Date.now();

  // 1. Unfulfilled orders >48h
  const unfulfilled = await Order.find({
    'items.seller': sellerId,
    status: { $in: ['pending', 'paid', 'packed'] },
    createdAt: { $lt: new Date(now - 48 * 3600 * 1000) },
  }).select('_id');
  if (unfulfilled.length > 0) {
    signals.push({
      key: 'unfulfilled_48h',
      level: unfulfilled.length > 5 ? 'high' : 'medium',
      message: `${unfulfilled.length} orders are stuck past 48h — ship them today to protect your trust score.`,
      weight: Math.min(30, unfulfilled.length * 5),
    });
  }

  // 2. Stockouts on active products
  const stockouts = await Product.countDocuments({ seller: sellerId, isActive: true, stock: 0 });
  if (stockouts > 0) {
    signals.push({
      key: 'stockouts',
      level: stockouts > 3 ? 'high' : 'low',
      message: `${stockouts} of your listed products are out of stock — restock or mark inactive.`,
      weight: Math.min(20, stockouts * 4),
    });
  }

  // 3. Cancellation spike in last 14 days
  const since = new Date(now - 14 * 24 * 3600 * 1000);
  const recent = await Order.find({ 'items.seller': sellerId, createdAt: { $gte: since } }).select('status');
  const cancelRate = recent.length ? recent.filter((o) => o.status === 'cancelled').length / recent.length : 0;
  if (cancelRate > 0.2) {
    signals.push({
      key: 'cancellation_spike',
      level: 'high',
      message: `${Math.round(cancelRate * 100)}% of orders were cancelled in the last 14 days.`,
      weight: Math.round(cancelRate * 30),
    });
  }

  // 4. Chat response latency (approx): share of messages with no reply in 24h
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000);
  const inboundUnread = await Message.countDocuments({
    to: sellerId,
    createdAt: { $gte: weekAgo },
    readAt: null,
  });
  if (inboundUnread > 10) {
    signals.push({
      key: 'slow_chat',
      level: inboundUnread > 30 ? 'high' : 'medium',
      message: `${inboundUnread} buyer DMs unread this week — speed up replies to lift karma.`,
      weight: Math.min(20, Math.floor(inboundUnread / 3)),
    });
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  return { score, signals };
}

module.exports = { computeStress };
