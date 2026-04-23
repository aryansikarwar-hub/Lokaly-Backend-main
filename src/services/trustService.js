const Review = require('../models/Review');
const Order = require('../models/Order');
const User = require('../models/User');

/**
 * Recalculate a seller's trust score (0-100) from first-party signals.
 * Weights (sum=100):
 *   30 avg rating (scaled 0-30)
 *   20 delivered-on-time rate (of shipped+delivered orders)
 *   15 repeat-buyer share
 *   15 review sentiment mix (positive vs negative)
 *   10 verified flag bonus
 *   10 order fulfillment rate (delivered / non-cancelled)
 */
async function computeSellerTrust(sellerId) {
  const [reviews, orders, user] = await Promise.all([
    Review.find({ seller: sellerId }).select('rating sentiment buyer isRepeatBuyer createdAt'),
    Order.find({ 'items.seller': sellerId }).select('status buyer timeline createdAt'),
    User.findById(sellerId),
  ]);
  if (!user) return null;

  const reviewCount = reviews.length;
  const avgRating = reviewCount ? reviews.reduce((s, r) => s + r.rating, 0) / reviewCount : 0;
  const ratingPart = (avgRating / 5) * 30;

  const pos = reviews.filter((r) => r.sentiment.label === 'POSITIVE').length;
  const neg = reviews.filter((r) => r.sentiment.label === 'NEGATIVE').length;
  const sentimentRatio = reviewCount ? (pos - neg) / reviewCount : 0;
  const sentimentPart = 7.5 + Math.max(-7.5, Math.min(7.5, sentimentRatio * 7.5)); // [0..15]

  const uniqueBuyers = new Set(orders.map((o) => String(o.buyer)));
  const buyerOrderCounts = orders.reduce((acc, o) => {
    acc[o.buyer] = (acc[o.buyer] || 0) + 1;
    return acc;
  }, {});
  const repeaters = Object.values(buyerOrderCounts).filter((n) => n > 1).length;
  const repeatShare = uniqueBuyers.size ? repeaters / uniqueBuyers.size : 0;
  const repeatPart = repeatShare * 15;

  const delivered = orders.filter((o) => o.status === 'delivered');
  const nonCancelled = orders.filter((o) => o.status !== 'cancelled');
  const fulfillmentRate = nonCancelled.length ? delivered.length / nonCancelled.length : 0;
  const fulfillmentPart = fulfillmentRate * 10;

  // Delivered-on-time: treat deliveries within 7 days of creation as on time.
  const onTime = delivered.filter((o) => {
    const delivEntry = o.timeline?.find((t) => t.status === 'delivered');
    if (!delivEntry) return false;
    return (delivEntry.at - o.createdAt) <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const onTimeRate = delivered.length ? onTime / delivered.length : 0;
  const onTimePart = onTimeRate * 20;

  const verifiedPart = user.isVerifiedSeller ? 10 : 0;

  const trustScore = Math.round(ratingPart + sentimentPart + repeatPart + fulfillmentPart + onTimePart + verifiedPart);

  user.trustScore = Math.max(0, Math.min(100, trustScore));
  await user.save();

  // After trust recompute, promote to verified seller if criteria met.
  await maybeAutoVerifySeller(user);

  return {
    trustScore: user.trustScore,
    breakdown: {
      ratingPart, sentimentPart, repeatPart, fulfillmentPart, onTimePart, verifiedPart,
      reviewCount, avgRating, repeatShare, onTimeRate, fulfillmentRate,
    },
  };
}

/**
 * Promote a seller to isVerifiedSeller=true if emailVerified AND trustScore > 60.
 * Safe to call repeatedly; never demotes — User pre-save hook handles demotion.
 */
async function maybeAutoVerifySeller(user) {
  if (!user || user.role !== 'seller') return false;
  if (user.isVerifiedSeller) return false;
  if (!user.isEmailVerified) return false;
  if ((Number(user.trustScore) || 0) <= 60) return false;
  user.isVerifiedSeller = true;
  await user.save();
  return true;
}

module.exports = { computeSellerTrust, maybeAutoVerifySeller };
