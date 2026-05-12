const Product = require("../models/Product");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

exports.list = asyncHandler(async (req, res) => {
  const {
    q,
    search,
    category,
    minPrice,
    maxPrice,
    seller,
    sort = "new",
    page = 1,
    limit = 20,
  } = req.query;

  const filter = { isActive: true };

  const searchText =
    (typeof q === "string" && q.trim()) ||
    (typeof search === "string" && search.trim()) ||
    "";

  if (category) filter.category = category;
  if (seller) filter.seller = seller;

  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }

  if (searchText) {
    const rx = new RegExp(escapeRegex(searchText), "i");
    filter.$or = [
      { title: rx },
      { description: rx },
      { category: rx },
      { tags: rx },
    ];
  }

  const sortMap = {
    new: { createdAt: -1 },
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    rating: { rating: -1, reviewCount: -1 },
    popular: { salesCount: -1 },
  };

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [items, total] = await Promise.all([
    Product.find(filter)
      .sort(sortMap[sort] || sortMap.new)
      .skip(skip)
      .limit(limitNum)
      .populate("seller", "name shopName avatar trustScore isVerifiedSeller"),
    Product.countDocuments(filter),
  ]);

  res.json({
    items,
    page: pageNum,
    limit: limitNum,
    total,
    pages: Math.ceil(total / limitNum),
  });
});

exports.getById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate(
    "seller",
    "name shopName avatar trustScore isVerifiedSeller location"
  );

  if (!product) throw ApiError.notFound("Product not found");

  res.json({ product });
});

/* =========================================================
   HELPER: normalise an image/video entry from the request body.
   FIX: Handles all formats:
     - plain string URL
     - { url, publicId }
     - { secure_url, public_id }   (Cloudinary direct)
   Rejects blob:// and data: URIs (client-side only, never stored).
========================================================= */
function normaliseMedia(item) {
  if (!item) return null;

  let url = "";
  let publicId = "";

  if (typeof item === "string") {
    url = item.trim();
  } else if (typeof item === "object") {
    url = String(item.url || item.secure_url || "").trim();
    publicId = String(item.publicId || item.public_id || "").trim();
  }

  // Reject empty, blob, or data URIs — these are client-side only
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return null;

  return { url, publicId };
}

/* =========================================================
   HELPER: safely parse attributes from request body.
   Mongoose Map<String,String> requires all values to be strings.
   Accepts:
     - plain object   { color: "red" }
     - JSON string    '{"color":"red"}'  (just in case)
========================================================= */
function parseAttributes(raw) {
  if (!raw) return {};

  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return {}; }
  }

  if (typeof obj !== "object" || Array.isArray(obj)) return {};

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).trim();
    if (!key) continue;
    out[key] = String(v ?? "");
  }
  return out;
}

exports.create = asyncHandler(async (req, res) => {
  if (req.user.role !== "seller" && req.user.role !== "admin") {
    throw ApiError.forbidden("Only sellers can create products");
  }

  const body = req.body || {};

  // ── title ──────────────────────────────────────────────
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length < 3) {
    throw ApiError.badRequest("title must be at least 3 characters");
  }

  // ── price ──────────────────────────────────────────────
  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw ApiError.badRequest("price must be > 0");
  }

  // ── stock ──────────────────────────────────────────────
  const stock =
    body.stock === undefined || body.stock === "" ? 100 : Number(body.stock);
  if (!Number.isFinite(stock) || stock < 0) {
    throw ApiError.badRequest("stock must be >= 0");
  }

  // ── category ───────────────────────────────────────────
  const category =
    typeof body.category === "string" ? body.category.trim() : "";
  if (!category) {
    throw ApiError.badRequest("category is required");
  }

  // ── tags ───────────────────────────────────────────────
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  // ── images ─────────────────────────────────────────────
  let images = [];

  if (req.files?.length) {
    // multipart/form-data upload path (legacy fallback)
    const { toPublicUrl } = require("../middleware/upload");
    images = req.files
      .map((f) => toPublicUrl(f))
      .filter(Boolean)
      .map((url) => ({ url, publicId: "" }));
  } else if (Array.isArray(body.images)) {
    images = body.images.map(normaliseMedia).filter(Boolean);
  }

  // FIX: Validate at least one real image URL exists
  if (images.length === 0) {
    throw ApiError.badRequest(
      "At least one image is required. Make sure images finish uploading before submitting."
    );
  }

  // ── videos ─────────────────────────────────────────────
  let videos = [];
  if (Array.isArray(body.videos)) {
    videos = body.videos.map(normaliseMedia).filter(Boolean);
  }

  // ── attributes ─────────────────────────────────────────
  const attributes = parseAttributes(body.attributes);

  // ── build payload ──────────────────────────────────────
  const payload = {
    title,
    description: typeof body.description === "string" ? body.description.trim() : "",
    category,
    tags,
    price,
    stock,
    images,
    videos,
    attributes,
    seller: req.user._id,
    isActive: body.isActive !== false,
  };

  if (body.compareAtPrice !== undefined && body.compareAtPrice !== "") {
    const cap = Number(body.compareAtPrice);
    if (Number.isFinite(cap) && cap >= 0) {
      payload.compareAtPrice = cap;
    }
  }

  // Wrap Product.create in try/catch to surface Mongoose validation errors clearly
  let product;
  try {
    product = await Product.create(payload);
  } catch (err) {
    // Mongoose ValidationError → extract field messages
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors)
        .map((e) => e.message)
        .join(", ");
      throw ApiError.badRequest(`Validation failed: ${messages}`);
    }
    throw err;
  }

  res.status(201).json({ product });
});

/* =========================================================
   UPDATABLE fields whitelist
========================================================= */
const UPDATABLE_PRODUCT_FIELDS = [
  "title", "description", "category", "tags",
  "price", "compareAtPrice", "stock",
  "images", "videos", "attributes", "isActive",
];

exports.update = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) throw ApiError.notFound("Product not found");

  if (
    String(product.seller) !== String(req.user._id) &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not your product");
  }

  const body = req.body || {};

  if ("seller" in body) throw ApiError.badRequest("`seller` cannot be changed");
  if ("_id" in body) throw ApiError.badRequest("`_id` cannot be changed");

  // FIX: Normalise images using the same robust helper
  if (Array.isArray(body.images)) {
    body.images = body.images.map(normaliseMedia).filter(Boolean);
    if (body.images.length === 0) {
      throw ApiError.badRequest("At least one image is required");
    }
  }

  // Normalise videos
  if (Array.isArray(body.videos)) {
    body.videos = body.videos.map(normaliseMedia).filter(Boolean);
  }

  // FIX: Normalise attributes for update using the same helper
  if ("attributes" in body) {
    body.attributes = parseAttributes(body.attributes);
  }

  // Apply whitelisted fields
  for (const key of UPDATABLE_PRODUCT_FIELDS) {
    if (key in body) product[key] = body[key];
  }

  // Re-validate numeric fields after assignment
  if ("price" in body) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw ApiError.badRequest("price must be > 0");
    }
    product.price = price;
  }

  if ("stock" in body) {
    const stock = Number(body.stock);
    if (!Number.isFinite(stock) || stock < 0) {
      throw ApiError.badRequest("stock must be >= 0");
    }
    product.stock = stock;
  }

  if ("title" in body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length < 3) {
      throw ApiError.badRequest("title must be at least 3 characters");
    }
    product.title = title;
  }

  let updated;
  try {
    updated = await product.save();
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors)
        .map((e) => e.message)
        .join(", ");
      throw ApiError.badRequest(`Validation failed: ${messages}`);
    }
    throw err;
  }

  res.json({ product: updated });
});

exports.remove = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) throw ApiError.notFound("Product not found");

  if (
    String(product.seller) !== String(req.user._id) &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not your product");
  }

  product.isActive = false;
  await product.save();

  res.json({ ok: true });
});

exports.mine = asyncHandler(async (req, res) => {
  const items = await Product.find({ seller: req.user._id }).sort({
    createdAt: -1,
  });

  res.json({ items });
});