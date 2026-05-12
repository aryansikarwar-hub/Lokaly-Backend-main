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

    // Regex fallback keeps search usable even when text indexes are stale/missing.
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
      .populate(
        "seller",
        "name shopName avatar trustScore isVerifiedSeller"
      ),

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

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  res.json({ product });
});

exports.create = asyncHandler(async (req, res) => {
  if (req.user.role !== "seller" && req.user.role !== "admin") {
    throw ApiError.forbidden("Only sellers can create products");
  }

  const body = req.body || {};

  const title =
    typeof body.title === "string" ? body.title.trim() : "";

  if (!title || title.length < 3) {
    throw ApiError.badRequest(
      "title must be at least 3 characters"
    );
  }

  const price = Number(body.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw ApiError.badRequest("price must be > 0");
  }

  const stock =
    body.stock === undefined || body.stock === ""
      ? 100
      : Number(body.stock);

  if (!Number.isFinite(stock) || stock < 0) {
    throw ApiError.badRequest("stock must be >= 0");
  }

  const category =
    typeof body.category === "string"
      ? body.category.trim()
      : "";

  if (!category) {
    throw ApiError.badRequest("category is required");
  }

  const tags = Array.isArray(body.tags)
    ? body.tags
        .map((t) => String(t).trim())
        .filter(Boolean)
    : [];

  // Build images array from uploaded files
  // or from body (URL strings / objects)
  const { toPublicUrl } = require("../middleware/upload");

  let images = [];

  if (req.files?.length) {
    // multipart upload path (legacy)
    images = req.files
      .map((f) => toPublicUrl(f))
      .filter(Boolean)
      .map((url) => ({
        url,
        publicId: "",
      }));
  } else if (Array.isArray(body.images)) {
    // JSON path — frontend already uploaded via /api/upload
    images = body.images
      .map((img) => {
        if (!img) return null;

        // If frontend sends plain string URL
        if (typeof img === "string") {
          return {
            url: img,
            publicId: "",
          };
        }

        // If frontend sends object
        if (typeof img === "object" && img.url) {
          return {
            url: String(img.url),
            publicId: String(img.publicId || ""),
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  // Build videos array
  let videos = [];

  if (Array.isArray(body.videos)) {
    videos = body.videos
      .map((vid) => {
        if (!vid) return null;

        // If frontend sends plain string URL
        if (typeof vid === "string") {
          return {
            url: vid,
            publicId: "",
          };
        }

        // If frontend sends object
        if (typeof vid === "object" && vid.url) {
          return {
            url: String(vid.url),
            publicId: String(vid.publicId || ""),
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  const payload = {
    ...body,
    title,
    price,
    stock,
    category,
    tags,
    images,
    videos,
    seller: req.user._id,
  };

  // Prevent overwriting protected fields
  delete payload._id;
  delete payload.seller;
  delete payload.sellerLocation;

  const product = await Product.create(payload);

  res.status(201).json({ product });
});

const UPDATABLE_PRODUCT_FIELDS = [
  "title",
  "description",
  "category",
  "tags",
  "price",
  "compareAtPrice",
  "stock",
  "images",
  "videos",
  "attributes",
  "isActive",
];

exports.update = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  if (
    String(product.seller) !== String(req.user._id) &&
    req.user.role !== "admin"
  ) {
    throw ApiError.forbidden("Not your product");
  }

  const body = req.body || {};

  // Explicitly reject attempts to rewrite ownership / identity fields.
  if ("seller" in body) {
    throw ApiError.badRequest("`seller` cannot be changed");
  }

  if ("_id" in body) {
    throw ApiError.badRequest("`_id` cannot be changed");
  }

  // Normalize images
  if (Array.isArray(body.images)) {
    body.images = body.images
      .map((img) => {
        if (!img) return null;

        if (typeof img === "string") {
          return {
            url: img,
            publicId: "",
          };
        }

        if (typeof img === "object" && img.url) {
          return {
            url: String(img.url),
            publicId: String(img.publicId || ""),
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  // Normalize videos
  if (Array.isArray(body.videos)) {
    body.videos = body.videos
      .map((vid) => {
        if (!vid) return null;

        if (typeof vid === "string") {
          return {
            url: vid,
            publicId: "",
          };
        }

        if (typeof vid === "object" && vid.url) {
          return {
            url: String(vid.url),
            publicId: String(vid.publicId || ""),
          };
        }

        return null;
      })
      .filter(Boolean);
  }

  for (const key of UPDATABLE_PRODUCT_FIELDS) {
    if (key in body) {
      product[key] = body[key];
    }
  }

  // Validate numeric fields
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

  // Validate title
  if ("title" in body) {
    const title =
      typeof body.title === "string"
        ? body.title.trim()
        : "";

    if (!title) {
      throw ApiError.badRequest("title cannot be empty");
    }

    product.title = title;
  }

  await product.save();

  res.json({ product });
});

exports.remove = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

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
  const items = await Product.find({
    seller: req.user._id,
  }).sort({
    createdAt: -1,
  });

  res.json({ items });
});