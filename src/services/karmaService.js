const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Message = require('../models/Message');

/**
 * Fraud Karma — 0..100 behavioural aura for both buyers and sellers.
 *
 * Buyers: penalties for cancellations, returns, negative reviews given, flagged messages.
 * Sellers: penalties for unfulfilled orders, slow replies, negative review sentiment, flagged chats.
 */
async function computeBuyerKarma(userId) {
  const orders = await Order.find({ buyer: userId }).select('status createdAt timeline');
  const total = orders.length || 1;
  const cancelled = orders.filter((o) => o.status === 'cancelled').length;
  const refunded = orders.filter((o) => o.status === 'refunded').length;

  const reviewsGiven = await Review.find({ buyer: userId }).select('sentiment');
  const negRatio = reviewsGiven.length
    ? reviewsGiven.filter((r) => r.sentiment.label === 'NEGATIVE').length / reviewsGiven.length
    : 0;

  const flaggedMsgs = await Message.countDocuments({ from: userId, 'moderation.flagged': true });

  // Base 80, subtract penalties.
  let score = 80;
  score -= (cancelled / total) * 25;
  score -= (refunded / total) * 25;
  score -= negRatio * 15;
  score -= Math.min(20, flaggedMsgs * 2);
  score = Math.max(0, Math.min(100, Math.round(score)));

  await User.updateOne({ _id: userId }, { fraudKarma: score });
  return { fraudKarma: score, signals: { total, cancelled, refunded, negRatio, flaggedMsgs } };
}

async function computeSellerKarma(userId) {
  const orders = await Order.find({ 'items.seller': userId }).select('status createdAt timeline items');
  const mine = orders.filter((o) => o.items.some((i) => String(i.seller) === String(userId)));
  const total = mine.length || 1;

  const delivered = mine.filter((o) => o.status === 'delivered').length;
  const cancelled = mine.filter((o) => o.status === 'cancelled').length;
  const refunded = mine.filter((o) => o.status === 'refunded').length;

  // Stuck orders: older than 3 days and still in pending/paid/packed.
  const stuckCutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const stuck = mine.filter((o) =>
    ['pending', 'paid', 'packed'].includes(o.status) && o.createdAt.getTime() < stuckCutoff
  ).length;

  // Avg response time proxy: time between consecutive timeline updates (lower=better). Missing => slow.
  const responseTimeMs = mine
    .map((o) => (o.timeline[1] && o.timeline[0] ? o.timeline[1].at - o.timeline[0].at : null))
    .filter(Boolean);
  const avgResponseHours = responseTimeMs.length
    ? responseTimeMs.reduce((s, n) => s + n, 0) / responseTimeMs.length / 3600000
    : 24;

  const reviews = await Review.find({ seller: userId }).select('sentiment rating');
  const negRatio = reviews.length
    ? reviews.filter((r) => r.sentiment.label === 'NEGATIVE').length / reviews.length
    : 0;
  const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  const flaggedChats = await Message.countDocuments({ from: userId, 'moderation.flagged': true });

  let score = 75;
  score += (delivered / total) * 15;
  score -= (cancelled / total) * 20;
  score -= (refunded / total) * 15;
  score -= Math.min(20, stuck * 3);
  score -= Math.min(15, Math.max(0, avgResponseHours - 6) * 0.5);
  score -= negRatio * 15;
  score -= Math.min(20, flaggedChats * 2);
  score += (avgRating / 5) * 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  await User.updateOne({ _id: userId }, { fraudKarma: score });
  return {
    fraudKarma: score,
    signals: { total, delivered, cancelled, refunded, stuck, avgResponseHours, negRatio, avgRating, flaggedChats },
  };
}

module.exports = { computeBuyerKarma, computeSellerKarma };
