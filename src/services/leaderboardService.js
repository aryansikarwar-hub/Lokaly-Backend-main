// Leaderboard aggregation per spec:
//   GET /api/leaderboard?limit=50&scope=global|city&city=...&type=sellers|buyers
//
// Sellers: composite score = salesCount + rating*10 + trustScore + coins/100
//   Response: { _id, name, shopName, avatar, city, isVerifiedSeller, trustScore,
//               rating, salesCount, coins, score, rank }
//
// Buyers: sort coins desc, tie-break by reviewCount desc.
//   Response: { _id, name, avatar, city, role, coins, reviewCount, trustScore, score, rank }
//
// Auth optional. If caller authenticated and not in top N, their row is appended.

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const env = require('../config/env');

function clampLimit(raw, def = 50, max = 200) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return def;
  return Math.min(max, n);
}

async function optionalAuthUser(req) {
  if (req.user) return req.user;
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return null;
    const payload = jwt.verify(token, env.jwt.secret);
    return await User.findById(payload.sub);
  } catch (_) {
    return null;
  }
}

function cityFilter(scope, city) {
  if (scope === 'city' && city && String(city).trim()) {
    const safe = String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { 'location.city': new RegExp(`^${safe}$`, 'i') };
  }
  return {};
}

// Spec response shape:
// { _id, name, avatar, shopName, role, coins, trustScore,
//   salesCount, reviewCount, rating, rank, city }
function sellerRow(u, rank) {
  return {
    _id: u._id,
    name: u.name,
    avatar: u.avatar || '',
    shopName: u.shopName || null,
    role: u.role || 'seller',
    coins: Number(u.coins) || 0,
    trustScore: Number(u.trustScore) || 0,
    salesCount: Number(u.salesCount) || 0,
    reviewCount: Number(u.reviewCount) || 0,
    rating: Number((Number(u.rating) || 0).toFixed(2)),
    rank,
    city: (u.location && u.location.city) || null,
    isVerifiedSeller: !!u.isVerifiedSeller,
    score: Math.round(Number(u.score) || 0),
  };
}

function buyerRow(u, rank) {
  return {
    _id: u._id,
    name: u.name,
    avatar: u.avatar || '',
    shopName: u.shopName || null,
    role: u.role || 'buyer',
    coins: Number(u.coins) || 0,
    trustScore: Number(u.trustScore) || 0,
    salesCount: 0,
    reviewCount: Number(u.reviewCount) || 0,
    rating: 0,
    rank,
    city: (u.location && u.location.city) || null,
    score: Number(u.coins) || 0,
  };
}

async function sellersAgg(match, limit) {
  return User.aggregate([
    { $match: { role: 'seller', isActive: { $ne: false }, ...match } },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: 'seller',
        as: 'products',
      },
    },
    {
      $addFields: {
        salesCount: { $ifNull: [{ $sum: '$products.salesCount' }, 0] },
        rating: { $ifNull: [{ $avg: '$products.rating' }, 0] },
      },
    },
    {
      $addFields: {
        score: {
          $add: [
            '$salesCount',
            { $multiply: ['$rating', 10] },
            { $ifNull: ['$trustScore', 0] },
            { $divide: [{ $ifNull: ['$coins', 0] }, 100] },
          ],
        },
      },
    },
    {
      $project: {
        name: 1, shopName: 1, avatar: 1, location: 1,
        isVerifiedSeller: 1, trustScore: 1, rating: 1,
        salesCount: 1, coins: 1, score: 1, createdAt: 1,
      },
    },
    { $sort: { score: -1, createdAt: 1 } },
    { $limit: limit },
  ]);
}

async function buyersAgg(match, limit) {
  return User.aggregate([
    { $match: { role: 'buyer', isActive: { $ne: false }, ...match } },
    {
      $lookup: {
        from: 'reviews',
        localField: '_id',
        foreignField: 'buyer',
        as: 'reviews',
      },
    },
    { $addFields: { reviewCount: { $size: '$reviews' } } },
    {
      $project: {
        name: 1, avatar: 1, location: 1, role: 1,
        coins: 1, reviewCount: 1, trustScore: 1, createdAt: 1,
      },
    },
    { $sort: { coins: -1, reviewCount: -1, createdAt: 1 } },
    { $limit: limit },
  ]);
}

async function findSelfSeller(userId, match) {
  const all = await sellersAgg(match, 10000);
  const idx = all.findIndex((u) => String(u._id) === String(userId));
  if (idx < 0) return null;
  return sellerRow(all[idx], idx + 1);
}

async function findSelfBuyer(userId, match) {
  const all = await buyersAgg(match, 10000);
  const idx = all.findIndex((u) => String(u._id) === String(userId));
  if (idx < 0) return null;
  return buyerRow(all[idx], idx + 1);
}

// Fallback when the whole dataset has zero activity (fresh install). Returns oldest
// users first so the "first user" is always visible somewhere on the board.
async function freshInstallFallback(match, limit) {
  const rows = await User.find({ isActive: { $ne: false }, ...match })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('name avatar shopName role coins trustScore location isVerifiedSeller createdAt');
  return rows.map((u, i) => ({
    _id: u._id,
    name: u.name,
    avatar: u.avatar || '',
    shopName: u.shopName || null,
    role: u.role,
    coins: u.coins || 0,
    trustScore: u.trustScore || 0,
    salesCount: 0,
    reviewCount: 0,
    rating: 0,
    rank: i + 1,
    city: (u.location && u.location.city) || null,
    isVerifiedSeller: !!u.isVerifiedSeller,
    score: 0,
  }));
}

async function runLeaderboard(req) {
  const limit = clampLimit(req.query.limit);

  // Accept both `type` (legacy: sellers/buyers) and `role` (spec: seller/buyer).
  // Unknown / missing → default to sellers.
  const roleParam = (req.query.role || '').toLowerCase();
  const typeParam = (req.query.type || '').toLowerCase();
  const type = (roleParam === 'buyer' || typeParam === 'buyers') ? 'buyers' : 'sellers';

  // If `city` is provided, infer scope=city automatically (spec). Otherwise honour scope param.
  const city = req.query.city ? String(req.query.city) : null;
  const scope = city ? 'city' : ((req.query.scope || 'global').toLowerCase() === 'city' ? 'city' : 'global');
  const match = cityFilter(scope, city);

  const me = await optionalAuthUser(req);
  let entries;
  let self = null;

  if (type === 'buyers') {
    const rows = await buyersAgg(match, limit);
    entries = rows.map((u, i) => buyerRow(u, i + 1));
    if (me && me.role === 'buyer') {
      if (!entries.find((e) => String(e._id) === String(me._id))) {
        self = await findSelfBuyer(me._id, match);
      }
    }
  } else {
    const rows = await sellersAgg(match, limit);
    entries = rows.map((u, i) => sellerRow(u, i + 1));
    if (me && me.role === 'seller') {
      if (!entries.find((e) => String(e._id) === String(me._id))) {
        self = await findSelfSeller(me._id, match);
      }
    }
  }

  // Fresh-install fallback — if nothing in the top slice has any activity, fall back to
  // oldest-user-first so the "first user" always appears.
  if (entries.length === 0 ||
      entries.every((e) => (e.salesCount || 0) === 0 && (e.reviewCount || 0) === 0 &&
                           (e.coins || 0) === 0 && (Number(e.trustScore) || 50) === 50)) {
    const fallbackMatch = type === 'buyers' ? { role: 'buyer', ...match } : { role: 'seller', ...match };
    const fallback = await freshInstallFallback(fallbackMatch, limit);
    if (fallback.length > 0) entries = fallback;
  }

  if (self) entries = entries.concat([self]);

  return { entries, type, scope, city, me: self };
}

module.exports = { runLeaderboard };
