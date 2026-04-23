const Cart = require('../models/Cart');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

async function loadOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

exports.get = asyncHandler(async (req, res) => {
  const cart = await loadOrCreateCart(req.user._id);
  await cart.populate('items.product', 'title images price stock seller slug');
  res.json({ cart, subtotal: cart.subtotal() });
});

exports.add = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body || {};
  const qty = Math.max(1, parseInt(quantity, 10));
  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw ApiError.notFound('Product not available');
  if (product.stock < qty) throw ApiError.badRequest('Insufficient stock');

  const cart = await loadOrCreateCart(req.user._id);
  const existing = cart.items.find((i) => String(i.product) === String(productId));
  if (existing) existing.quantity += qty;
  else cart.items.push({ product: product._id, quantity: qty, priceAtAdd: product.price });
  await cart.save();
  await cart.populate('items.product', 'title images price stock seller slug');
  res.json({ cart, subtotal: cart.subtotal() });
});

exports.updateQty = asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body || {};
  const qty = parseInt(quantity, 10);
  const cart = await loadOrCreateCart(req.user._id);
  const item = cart.items.find((i) => String(i.product) === String(productId));
  if (!item) throw ApiError.notFound('Item not in cart');
  if (qty <= 0) cart.items = cart.items.filter((i) => String(i.product) !== String(productId));
  else item.quantity = qty;
  await cart.save();
  await cart.populate('items.product', 'title images price stock seller slug');
  res.json({ cart, subtotal: cart.subtotal() });
});

exports.remove = asyncHandler(async (req, res) => {
  const cart = await loadOrCreateCart(req.user._id);
  cart.items = cart.items.filter((i) => String(i.product) !== String(req.params.productId));
  await cart.save();
  res.json({ cart, subtotal: cart.subtotal() });
});

exports.clear = asyncHandler(async (req, res) => {
  const cart = await loadOrCreateCart(req.user._id);
  cart.items = [];
  await cart.save();
  res.json({ cart });
});
