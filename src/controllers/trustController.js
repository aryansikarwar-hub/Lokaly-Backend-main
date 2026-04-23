const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { computeSellerTrust } = require('../services/trustService');

exports.get = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId).select('name trustScore fraudKarma isVerifiedSeller shopName avatar role');
  if (!user) throw ApiError.notFound();

  let breakdown = null;
  if (user.role === 'seller') {
    const out = await computeSellerTrust(user._id).catch(() => null);
    breakdown = out?.breakdown || null;
  }
  res.json({ user, breakdown, trustScore: user.trustScore, fraudKarma: user.fraudKarma });
});
