const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

exports.list = asyncHandler(async (req, res) => {
  const {
    q, category, minPrice, maxPrice, seller, sort = 'new',
    page = 1, limit = 20,
  } = req.query;

  const filter = { isActive: true };
  if (category) filter.category = category;
  if (seller) filter.seller = seller;
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }
  if (q) filter.$text = { $search: q };

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
      .populate('seller', 'name shopName avatar trustScore isVerifiedSeller'),
    Product.countDocuments(filter),
  ]);

  res.json({ items, page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) });
});

exports.getById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate('seller', 'name shopName avatar trustScore isVerifiedSeller location');
  if (!product) throw ApiError.notFound('Product not found');
  res.json({ product });
});

exports.create = asyncHandler(async (req, res) => {
  if (req.user.role !== 'seller' && req.user.role !== 'admin') {
    throw ApiError.forbidden('Only sellers can create products');
  }
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length < 3) throw ApiError.badRequest('title must be at least 3 characters');
  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) throw ApiError.badRequest('price must be > 0');
  const stock = body.stock === undefined ? 0 : Number(body.stock);
  if (!Number.isFinite(stock) || stock < 0) throw ApiError.badRequest('stock must be >= 0');
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  if (!category) throw ApiError.badRequest('category is required');
  const images = Array.isArray(body.images)
    ? body.images.filter((i) => i && (i.url || typeof i === 'string'))
    : [];
  if (images.length < 1) throw ApiError.badRequest('at least 1 image required');

  const payload = { ...body, title, price, stock, category, images, seller: req.user._id };
  delete payload._id;
  const product = await Product.create(payload);
  res.status(201).json({ product });
});

const UPDATABLE_PRODUCT_FIELDS = [
  'title', 'description', 'category', 'tags',
  'price', 'compareAtPrice', 'stock',
  'images', 'videos', 'attributes', 'isActive',
];

exports.update = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (String(product.seller) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your product');
  }
  const body = req.body || {};
  // Explicitly reject attempts to rewrite ownership / identity fields.
  if ('seller' in body) throw ApiError.badRequest('`seller` cannot be changed');
  if ('_id' in body) throw ApiError.badRequest('`_id` cannot be changed');
  for (const key of UPDATABLE_PRODUCT_FIELDS) {
    if (key in body) product[key] = body[key];
  }
  // Validate after whitelist assignment.
  if ('price' in body) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw ApiError.badRequest('price must be > 0');
    product.price = price;
  }
  if ('stock' in body) {
    const stock = Number(body.stock);
    if (!Number.isFinite(stock) || stock < 0) throw ApiError.badRequest('stock must be >= 0');
    product.stock = stock;
  }
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw ApiError.badRequest('title cannot be empty');
    product.title = title;
  }
  await product.save();
  res.json({ product });
});

exports.remove = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (String(product.seller) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your product');
  }
  product.isActive = false;
  await product.save();
  res.json({ ok: true });
});

exports.mine = asyncHandler(async (req, res) => {
  const items = await Product.find({ seller: req.user._id }).sort({ createdAt: -1 });
  res.json({ items });
});
