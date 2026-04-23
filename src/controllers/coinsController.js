const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ledger, runCoinExpiry } = require('../services/coinsService');

exports.myLedger = asyncHandler(async (req, res) => {
  const items = await ledger(req.user._id, { limit: 100 });
  res.json({ items, balance: req.user.coins });
});

exports.redeem = asyncHandler(async (req, res) => {
  // Placeholder redemption — real redemption happens inline during checkout (Order.coinsRedeemed).
  throw ApiError.badRequest('Redeem coins during checkout via orders.coinsToRedeem');
});

exports.expire = asyncHandler(async (_req, res) => {
  const result = await runCoinExpiry();
  res.json({ ok: true, ...result });
});
