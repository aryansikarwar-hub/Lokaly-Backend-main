const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { parseLngLat, haversineKm, classifyDelivery } = require("../utils/geo");

/**
 * GET /api/hyperlocal/sellers/nearby?lng=&lat=&radiusKm=&limit=
 *
 * Find verified/active sellers near a point, sorted by distance.
 * Uses User.location.geo (2dsphere index already exists).
 */
exports.nearbySellers = asyncHandler(async (req, res) => {
  const { lng, lat, radiusKm = 10, limit = 12 } = req.query;
  const point = parseLngLat(lng, lat);
  if (!point) {
    return res.status(400).json({ error: "Invalid or missing lng/lat" });
  }

  const radiusMeters = Math.min(Math.max(Number(radiusKm), 1), 100) * 1000;
  const cap = Math.min(Math.max(Number(limit), 1), 50);

  const sellers = await User.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: point },
        distanceField: "distanceMeters",
        maxDistance: radiusMeters,
        spherical: true,
        query: { role: "seller", isActive: true },
      },
    },
    { $limit: cap },
    {
      $project: {
        name: 1,
        shopName: 1,
        shopCategory: 1,
        avatar: 1,
        bio: 1,
        trustScore: 1,
        isVerifiedSeller: 1,
        location: {
          city: "$location.city",
          pincode: "$location.pincode",
        },
        distanceKm: { $divide: ["$distanceMeters", 1000] },
      },
    },
  ]);

  // Attach delivery classification and a sample of recent products per seller
  // (small, non-blocking — kept lean for the homepage rail).
  const sellerIds = sellers.map((s) => s._id);
  const sampleProducts = await Product.find({
    seller: { $in: sellerIds },
    isActive: true,
  })
    .sort({ createdAt: -1 })
    .select("title price images seller")
    .lean();

  const productsBySeller = sampleProducts.reduce((acc, p) => {
    const key = String(p.seller);
    if (!acc[key]) acc[key] = [];
    if (acc[key].length < 3) acc[key].push(p);
    return acc;
  }, {});

  const enriched = sellers.map((s) => ({
    ...s,
    delivery: classifyDelivery(s.distanceKm),
    sampleProducts: productsBySeller[String(s._id)] || [],
  }));

  res.json({ items: enriched, count: enriched.length });
});

/**
 * GET /api/hyperlocal/products/nearby?lng=&lat=&radiusKm=&category=&limit=&page=
 *
 * Returns products whose seller is within radiusKm of the buyer,
 * AND whose deliveryRadiusKm allows delivery to that distance.
 * Sorted by distance ascending (closest first).
 */
exports.nearbyProducts = asyncHandler(async (req, res) => {
  const { lng, lat, radiusKm = 10, category, limit = 24, page = 1 } = req.query;
  const point = parseLngLat(lng, lat);
  if (!point) {
    return res.status(400).json({ error: "Invalid or missing lng/lat" });
  }

  const radiusMeters = Math.min(Math.max(Number(radiusKm), 1), 100) * 1000;
  const cap = Math.min(Math.max(Number(limit), 1), 48);
  const skip = (Math.max(Number(page), 1) - 1) * cap;

  const query = { isActive: true };
  if (category && category !== "All") query.category = category;

  const items = await Product.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: point },
        distanceField: "distanceMeters",
        maxDistance: radiusMeters,
        spherical: true,
        query,
        key: "sellerLocation.geo",
      },
    },
    // Drop products whose deliveryRadiusKm does not cover this distance.
    {
      $match: {
        $expr: {
          $gte: [{ $multiply: ["$deliveryRadiusKm", 1000] }, "$distanceMeters"],
        },
      },
    },
    { $skip: skip },
    { $limit: cap },
    {
      $lookup: {
        from: "users",
        localField: "seller",
        foreignField: "_id",
        as: "sellerDoc",
        pipeline: [
          {
            $project: {
              name: 1,
              shopName: 1,
              avatar: 1,
              trustScore: 1,
              isVerifiedSeller: 1,
              "location.city": 1,
            },
          },
        ],
      },
    },
    { $unwind: { path: "$sellerDoc", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        seller: "$sellerDoc",
        distanceKm: { $divide: ["$distanceMeters", 1000] },
      },
    },
    { $project: { sellerDoc: 0, embedding: 0 } },
  ]);

  // Stamp delivery classification on each product. Lightweight, in-memory.
  const enriched = items.map((p) => ({
    ...p,
    delivery: classifyDelivery(p.distanceKm),
  }));

  res.json({ items: enriched, count: enriched.length, page: Number(page) });
});

/**
 * GET /api/hyperlocal/products/trending?lng=&lat=&radiusKm=&pincode=&limit=
 *
 * "Trending in your locality" — combines recent orders + view spikes
 * within a 7-day window for sellers near the buyer.
 *
 * Strategy:
 *  1. Find seller IDs within radius (or matching pincode if lng/lat absent).
 *  2. Score products = (orders_last_7d * 5) + (views_last_7d * 1).
 *  3. Return top N.
 *
 * In-memory scoring is fine at our scale; if this gets hot, cache the
 * result keyed by floor(lat,2)+floor(lng,2)+radius for 10 minutes.
 */
exports.trendingProducts = asyncHandler(async (req, res) => {
  const { lng, lat, radiusKm = 10, pincode, limit = 12 } = req.query;
  const cap = Math.min(Math.max(Number(limit), 1), 24);

  // 1. Build the seller-set
  let sellerIds = [];
  const point = parseLngLat(lng, lat);

  if (point) {
    const radiusMeters = Math.min(Math.max(Number(radiusKm), 1), 100) * 1000;
    const sellers = await User.find({
      role: "seller",
      isActive: true,
      "location.geo": {
        $near: {
          $geometry: { type: "Point", coordinates: point },
          $maxDistance: radiusMeters,
        },
      },
    })
      .select("_id")
      .lean();
    sellerIds = sellers.map((s) => s._id);
  } else if (pincode) {
    const sellers = await User.find({
      role: "seller",
      isActive: true,
      "location.pincode": String(pincode),
    })
      .select("_id")
      .lean();
    sellerIds = sellers.map((s) => s._id);
  } else {
    return res.status(400).json({ error: "Provide lng/lat or pincode" });
  }

  if (sellerIds.length === 0) {
    return res.json({ items: [], count: 0, source: "no-local-sellers" });
  }

  // 2. Recent orders (last 7 days) — count product appearances
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentOrders = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: sevenDaysAgo },
        status: {
          $in: ["paid", "packed", "shipped", "out_for_delivery", "delivered"],
        },
        "items.seller": { $in: sellerIds },
      },
    },
    { $unwind: "$items" },
    { $match: { "items.seller": { $in: sellerIds } } },
    {
      $group: {
        _id: "$items.product",
        orderCount: { $sum: "$items.quantity" },
      },
    },
  ]);

  const orderScoreMap = new Map(
    recentOrders.map((r) => [String(r._id), r.orderCount]),
  );

  // 3. Pull active products from these sellers + their view buckets
  const products = await Product.find({
    seller: { $in: sellerIds },
    isActive: true,
  })
    .select(
      "title price images category seller rating reviewCount salesCount viewsByDay isFlashDeal compareAtPrice",
    )
    .populate(
      "seller",
      "name shopName avatar trustScore isVerifiedSeller location.city",
    )
    .lean();

  // 4. Score each product
  const todayMs = Date.now();
  const cutoffDate = new Date(todayMs - 7 * 24 * 60 * 60 * 1000);
  const scored = products.map((p) => {
    const recentViews = (p.viewsByDay || [])
      .filter((b) => new Date(b.date).getTime() >= cutoffDate.getTime())
      .reduce((sum, b) => sum + (b.count || 0), 0);
    const orderScore = orderScoreMap.get(String(p._id)) || 0;
    const score = orderScore * 5 + recentViews;
    return {
      ...p,
      _trendScore: score,
      _recentViews: recentViews,
      _recentOrders: orderScore,
    };
  });

  // 5. Sort + take top N. If everything has score 0 (cold start),
  // fall back to newest-first so we never return an empty rail.
  scored.sort((a, b) => b._trendScore - a._trendScore);
  const hasSignal = scored.some((p) => p._trendScore > 0);
  const items = (hasSignal ? scored : products).slice(0, cap);

  res.json({
    items,
    count: items.length,
    source: hasSignal ? "signal" : "cold-start-fallback",
  });
});

/**
 * POST /api/hyperlocal/products/:id/view
 * Lightweight view tracker. Fire-and-forget from the client when a
 * product detail page mounts.
 */
exports.trackView = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid product id" });
  }
  await Product.incrementView(id);
  res.json({ ok: true });
});
