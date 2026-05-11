const User = require("../models/User");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// GET wishlist
exports.getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: "wishlist",
    populate: {
      path: "seller",
      select: "name shopName avatar trustScore isVerifiedSeller",
    },
  });

  res.json({
    items: user.wishlist || [],
  });
});

// TOGGLE wishlist
exports.toggleWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  if (!productId) {
    throw ApiError.badRequest("productId required");
  }

  const product = await Product.findById(productId);

  if (!product) {
    throw ApiError.notFound("Product not found");
  }

  const user = await User.findById(req.user._id);

  const exists = user.wishlist.some((id) => String(id) === String(productId));

  if (exists) {
    user.wishlist = user.wishlist.filter(
      (id) => String(id) !== String(productId),
    );
  } else {
    user.wishlist.push(productId);
  }

  await user.save();

  res.json({
    saved: !exists,
    wishlist: user.wishlist,
  });
});
