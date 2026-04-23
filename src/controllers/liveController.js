const crypto = require('crypto');
const LiveSession = require('../models/LiveSession');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

exports.list = asyncHandler(async (req, res) => {
  const { status = 'live' } = req.query;
  const filter = status === 'all' ? {} : { status };
  const sessions = await LiveSession.find(filter)
    .sort({ startedAt: -1, scheduledAt: -1 })
    .populate('host', 'name shopName avatar trustScore isVerifiedSeller')
    .populate('featuredProducts', 'title price images slug');
  res.json({ sessions });
});

exports.getById = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id)
    .populate('host', 'name shopName avatar trustScore isVerifiedSeller')
    .populate('coHosts', 'name avatar')
    .populate('featuredProducts', 'title price images slug stock');
  if (!s) throw ApiError.notFound('Live session not found');
  res.json({ session: s });
});

exports.create = asyncHandler(async (req, res) => {
  if (req.user.role !== 'seller') throw ApiError.forbidden('Only sellers can host');
  const { title, description, coverImage, category, scheduledAt, featuredProducts = [], groupBuy } = req.body || {};
  if (!title) throw ApiError.badRequest('title required');

  const roomId = `live_${crypto.randomBytes(4).toString('hex')}`;
  const streamKey = crypto.randomBytes(16).toString('hex');

  const s = await LiveSession.create({
    host: req.user._id,
    title,
    description,
    coverImage,
    category,
    scheduledAt,
    featuredProducts,
    groupBuy,
    roomId,
    streamKey,
    status: scheduledAt ? 'scheduled' : 'live',
    startedAt: scheduledAt ? undefined : new Date(),
  });
  res.status(201).json({ session: s });
});

exports.start = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();
  s.status = 'live';
  s.startedAt = new Date();
  await s.save();
  req.app.get('io')?.emit('live:started', { id: s._id, roomId: s.roomId });
  res.json({ session: s });
});

exports.end = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();
  s.status = 'ended';
  s.endedAt = new Date();
  await s.save();
  req.app.get('io')?.to(`live:${s.roomId}`).emit('live:ended', { id: s._id });
  res.json({ session: s });
});

exports.addFlashDeal = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();
  const { product, discountPct, durationSeconds = 30, maxClaims = 20 } = req.body || {};
  const deal = { product, discountPct, endsAt: new Date(Date.now() + durationSeconds * 1000), maxClaims };
  s.flashDeals.push(deal);
  await s.save();
  const created = s.flashDeals[s.flashDeals.length - 1];
  req.app.get('io')?.to(`live:${s.roomId}`).emit('live:flashDeal', created);
  res.status(201).json({ deal: created });
});

exports.claimFlashDeal = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  const deal = s.flashDeals.id(req.params.dealId);
  if (!deal) throw ApiError.notFound('deal');
  if (deal.endsAt < new Date()) throw ApiError.badRequest('deal expired');
  if (deal.claimedBy.length >= deal.maxClaims) throw ApiError.badRequest('deal sold out');
  if (deal.claimedBy.some((u) => String(u) === String(req.user._id))) throw ApiError.badRequest('already claimed');
  deal.claimedBy.push(req.user._id);
  await s.save();
  req.app.get('io')?.to(`live:${s.roomId}`).emit('live:dealClaimed', { dealId: deal._id, remaining: deal.maxClaims - deal.claimedBy.length });
  res.json({ ok: true, deal });
});

exports.addPoll = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();
  const { question, options } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2) throw ApiError.badRequest('invalid poll');
  s.polls.push({ question, options: options.map((text) => ({ text, votes: 0 })) });
  await s.save();
  const poll = s.polls[s.polls.length - 1];
  req.app.get('io')?.to(`live:${s.roomId}`).emit('live:poll', poll);
  res.status(201).json({ poll });
});

exports.votePoll = asyncHandler(async (req, res) => {
  const { optionIndex } = req.body || {};
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  const poll = s.polls.id(req.params.pollId);
  if (!poll) throw ApiError.notFound('poll');
  if (poll.voters.some((u) => String(u) === String(req.user._id))) throw ApiError.badRequest('already voted');
  if (!poll.options[optionIndex]) throw ApiError.badRequest('bad option');
  poll.options[optionIndex].votes += 1;
  poll.voters.push(req.user._id);
  await s.save();
  req.app.get('io')?.to(`live:${s.roomId}`).emit('live:pollUpdate', poll);
  res.json({ poll });
});

exports.spin = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  // Spin-the-wheel: random discount drawn from a fixed palette.
  const prizes = [
    { label: '5% off', type: 'discount', value: 5 },
    { label: '10% off', type: 'discount', value: 10 },
    { label: 'Free shipping', type: 'shipping', value: 0 },
    { label: '50 coins', type: 'coins', value: 50 },
    { label: '15% off', type: 'discount', value: 15 },
    { label: 'Try again', type: 'none', value: 0 },
  ];
  const prize = prizes[Math.floor(Math.random() * prizes.length)];
  if (prize.type === 'coins') {
    req.user.coins += prize.value;
    await req.user.save();
  }
  req.app.get('io')?.to(`live:${s.roomId}`).emit('live:spin', { user: req.user._id, prize });
  res.json({ prize });
});

exports.joinGroupBuy = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (!s.groupBuy.participants.some((u) => String(u) === String(req.user._id))) {
    s.groupBuy.participants.push(req.user._id);
  }
  if (!s.groupBuy.unlocked && s.groupBuy.participants.length >= s.groupBuy.threshold) {
    s.groupBuy.unlocked = true;
    req.app.get('io')?.to(`live:${s.roomId}`).emit('live:groupBuyUnlocked', { discountPct: s.groupBuy.discountPct });
  }
  await s.save();
  res.json({ groupBuy: s.groupBuy });
});
