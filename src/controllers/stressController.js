const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { computeStress } = require('../services/stressService');
const { computeSellerKarma, computeBuyerKarma } = require('../services/karmaService');

exports.mine = asyncHandler(async (req, res) => {
  if (req.user.role !== 'seller' && req.user.role !== 'admin') throw ApiError.forbidden();
  const out = await computeStress(req.user._id);
  res.json(out);
});

exports.myKarma = asyncHandler(async (req, res) => {
  const out = req.user.role === 'seller'
    ? await computeSellerKarma(req.user._id)
    : await computeBuyerKarma(req.user._id);
  res.json(out);
});
