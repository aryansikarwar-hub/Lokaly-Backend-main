const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const CoinLedger = require('../models/CoinLedger');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { computeSellerTrust } = require('../services/trustService');
const { award } = require('../services/coinsService');

async function recomputeProductRating(productId) {
  const agg = await Review.aggregate([
    { $match: { product: require('mongoose').Types.ObjectId.createFromHexString(String(productId)) } },
    { $group: { _id: '$product', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const row = agg[0];
  await Product.updateOne(
    { _id: productId },
    { rating: row?.avg || 0, reviewCount: row?.count || 0 }
  );
}

exports.create = asyncHandler(async (req, res) => {
  const { product, order, rating, text = '', images = [] } = req.body || {};
  if (!product || !rating) throw ApiError.badRequest('product and rating required');
  if (rating < 1 || rating > 5) throw ApiError.badRequest('rating must be 1-5');

  const prod = await Product.findById(product);
  if (!prod) throw ApiError.notFound('Product not found');

  // Verify the buyer purchased (optional — demo is lenient).
  let isRepeatBuyer = false;
  if (order) {
    const ord = await Order.findById(order);
    if (!ord || String(ord.buyer) !== String(req.user._id)) throw ApiError.forbidden('Not your order');
    const priorOrders = await Order.countDocuments({
      buyer: req.user._id,
      'items.seller': prod.seller,
      _id: { $ne: ord._id },
    });
    isRepeatBuyer = priorOrders > 0;
  }

  // Sentiment via ML service if available.
  let sentiment = { label: 'NEUTRAL', score: 0 };
  try {
    const { sentimentOf } = require('./mlController');
    sentiment = await sentimentOf(text);
  } catch (_) { /* optional until T15 */ }

  let review;
  try {
    review = await Review.create({
      buyer: req.user._id,
      seller: prod.seller,
      product: prod._id,
      order,
      rating,
      text,
      images,
      sentiment,
      isRepeatBuyer,
    });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('You have already reviewed this product');
    throw err;
  }

  await recomputeProductRating(prod._id);
  computeSellerTrust(prod.seller).catch(() => null); // fire-and-forget

  // Award 10 coins for this review — capped to 1 reward per (user, product).
  // Dedup key is `meta.productId` per spec.
  try {
    const already = await CoinLedger.findOne({
      user: req.user._id,
      reason: 'review',
      'meta.productId': String(prod._id),
    }).lean();
    if (!already) {
      await award(req.user._id, 10, 'review', {
        productId: String(prod._id),
        reviewId: String(review._id),
      });
    }
  } catch (_) { /* non-fatal */ }

  res.status(201).json({ review });
});

exports.forProduct = asyncHandler(async (req, res) => {
  const items = await Review.find({ product: req.params.productId })
    .sort({ createdAt: -1 })
    .populate('buyer', 'name avatar trustScore');
  res.json({ items });
});

exports.forSeller = asyncHandler(async (req, res) => {
  const items = await Review.find({ seller: req.params.userId })
    .sort({ createdAt: -1 })
    .populate('buyer', 'name avatar')
    .populate('product', 'title images slug');
  res.json({ items });
});

exports.voteHelpful = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound();
  const uid = String(req.user._id);
  const idx = review.helpfulVotes.findIndex((u) => String(u) === uid);
  if (idx >= 0) review.helpfulVotes.splice(idx, 1);
  else review.helpfulVotes.push(req.user._id);
  await review.save();
  res.json({ helpful: idx < 0, count: review.helpfulVotes.length });
});
