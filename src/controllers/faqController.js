const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Message = require('../models/Message');
const { suggestFaqReply } = require('../services/moderationService');

exports.suggest = asyncHandler(async (req, res) => {
  const { query, sellerId } = req.query;
  if (!query || !sellerId) throw ApiError.badRequest('query and sellerId required');
  const suggestion = await suggestFaqReply({ toUser: sellerId, text: query });
  res.json({ suggestion });
});

exports.flaggedForSeller = asyncHandler(async (req, res) => {
  const items = await Message.find({ to: req.user._id, 'moderation.flagged': true })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('from', 'name avatar fraudKarma');
  res.json({ items });
});
