const crypto = require("crypto");
const LiveSession = require("../models/LiveSession");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { createAndEmitNotification } = require("../services/notificationService");

// ────────────────────────────────────────────────────────
// FEATURED STREAMS — for homepage card carousel
// Priority: live > scheduled > recently ended
// Public route (no auth)
// ────────────────────────────────────────────────────────
exports.getFeatured = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);

  const populateHost = {
    path: "host",
    select:
      "name shopName shopCategory avatar location isVerifiedSeller trustScore",
  };

  // Priority 1: LIVE streams (sorted by viewers desc)
  const liveStreams = await LiveSession.find({ status: "live" })
    .sort({ "stats.peakViewers": -1, startedAt: -1 })
    .limit(limit)
    .populate(populateHost)
    .lean();

  // Priority 2: SCHEDULED upcoming streams (fill remaining slots)
  let scheduledStreams = [];
  if (liveStreams.length < limit) {
    scheduledStreams = await LiveSession.find({
      status: "scheduled",
      scheduledAt: { $gte: new Date() },
    })
      .sort({ scheduledAt: 1 })
      .limit(limit - liveStreams.length)
      .populate(populateHost)
      .lean();
  }

  // Priority 3: Recently ENDED streams (fill remaining slots)
  let endedStreams = [];
  const remaining = limit - liveStreams.length - scheduledStreams.length;
  if (remaining > 0) {
    endedStreams = await LiveSession.find({ status: "ended" })
      .sort({ endedAt: -1 })
      .limit(remaining)
      .populate(populateHost)
      .lean();
  }

  const all = [...liveStreams, ...scheduledStreams, ...endedStreams];

  // Shape response — flat structure for frontend
  const streams = all.map((s) => ({
    streamId: s._id,
    roomId: s.roomId,
    title: s.title,
    description: s.description,
    coverImage: s.coverImage,
    category: s.category || s.host?.shopCategory || "General",
    status: s.status,
    startedAt: s.startedAt,
    scheduledAt: s.scheduledAt,
    viewers: s.stats?.peakViewers || 0,
    host: {
      _id: s.host?._id,
      name: s.host?.name,
      shopName: s.host?.shopName || s.title,
      avatar: s.host?.avatar,
      city: s.host?.location?.city || "India",
      state: s.host?.location?.state,
      isVerified: s.host?.isVerifiedSeller || false,
      trustScore: s.host?.trustScore || 50,
    },
  }));

  res.json({
    success: true,
    count: streams.length,
    streams,
  });
});

// ────────────────────────────────────────────────────────
// LIST sessions by status
// ────────────────────────────────────────────────────────
exports.list = asyncHandler(async (req, res) => {
  const { status = "live" } = req.query;
  const filter = status === "all" ? {} : { status };
  const sessions = await LiveSession.find(filter)
    .sort({ startedAt: -1, scheduledAt: -1 })
    .populate("host", "name shopName avatar trustScore isVerifiedSeller")
    .populate("featuredProducts", "title price images slug");
  res.json({ sessions });
});

// ────────────────────────────────────────────────────────
// GET session by ID
// ────────────────────────────────────────────────────────
exports.getById = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id)
    .populate("host", "name shopName avatar trustScore isVerifiedSeller")
    .populate("coHosts", "name avatar")
    .populate("featuredProducts", "title price images slug stock");
  if (!s) throw ApiError.notFound("Live session not found");
  res.json({ session: s });
});

// ────────────────────────────────────────────────────────
// CREATE session (seller only)
// ────────────────────────────────────────────────────────
exports.create = asyncHandler(async (req, res) => {
  if (req.user.role !== "seller")
    throw ApiError.forbidden("Only sellers can host");

  const {
    title,
    description,
    coverImage,
    category,
    scheduledAt,
    featuredProducts = [],
    groupBuy,
  } = req.body || {};

  if (!title) throw ApiError.badRequest("title required");

  const roomId = `live_${crypto.randomBytes(4).toString("hex")}`;
  const streamKey = crypto.randomBytes(16).toString("hex");

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
    status: scheduledAt ? "scheduled" : "live",
    startedAt: scheduledAt ? undefined : new Date(),
  });

  res.status(201).json({ session: s });
});

// ────────────────────────────────────────────────────────
// START session (host only)
// ────────────────────────────────────────────────────────
exports.start = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();

  s.status = "live";
  s.startedAt = new Date();
  await s.save();

  req.app.get("io")?.emit("live:started", { id: s._id, roomId: s.roomId });
  const targetUsers = [
    ...new Set([
      ...s.coHosts.map((id) => String(id)),
      ...(s.groupBuy?.participants || []).map((id) => String(id)),
    ]),
  ].filter((id) => id !== String(req.user._id));
  await Promise.all(
    targetUsers.map((uid) =>
      createAndEmitNotification({
        userId: uid,
        type: "live_started",
        message: `${s.title} just went live`,
        sender: req.user._id,
        liveSessionId: s._id,
        dedupeKey: `live:${s._id}:started:${uid}`,
        meta: { roomId: s.roomId, title: s.title },
      })
    )
  );
  res.json({ session: s });
});

// ────────────────────────────────────────────────────────
// END session (host only)
// ────────────────────────────────────────────────────────
exports.end = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();

  s.status = "ended";
  s.endedAt = new Date();
  await s.save();

  req.app.get("io")?.to(`live:${s.roomId}`).emit("live:ended", { id: s._id });
  res.json({ session: s });
});

// ────────────────────────────────────────────────────────
// FLASH DEAL — add (host only)
// ────────────────────────────────────────────────────────
exports.addFlashDeal = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();

  const {
    product,
    discountPct,
    durationSeconds = 30,
    maxClaims = 20,
  } = req.body || {};

  const deal = {
    product,
    discountPct,
    endsAt: new Date(Date.now() + durationSeconds * 1000),
    maxClaims,
  };

  s.flashDeals.push(deal);
  await s.save();

  const created = s.flashDeals[s.flashDeals.length - 1];
  req.app.get("io")?.to(`live:${s.roomId}`).emit("live:flashDeal", created);
  res.status(201).json({ deal: created });
});

// ────────────────────────────────────────────────────────
// FLASH DEAL — claim
// ────────────────────────────────────────────────────────
exports.claimFlashDeal = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();

  const deal = s.flashDeals.id(req.params.dealId);
  if (!deal) throw ApiError.notFound("deal");
  if (deal.endsAt < new Date()) throw ApiError.badRequest("deal expired");
  if (deal.claimedBy.length >= deal.maxClaims)
    throw ApiError.badRequest("deal sold out");
  if (deal.claimedBy.some((u) => String(u) === String(req.user._id)))
    throw ApiError.badRequest("already claimed");

  deal.claimedBy.push(req.user._id);
  await s.save();

  req.app
    .get("io")
    ?.to(`live:${s.roomId}`)
    .emit("live:dealClaimed", {
      dealId: deal._id,
      remaining: deal.maxClaims - deal.claimedBy.length,
    });

  res.json({ ok: true, deal });
});

// ────────────────────────────────────────────────────────
// POLL — add (host only)
// ────────────────────────────────────────────────────────
exports.addPoll = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();
  if (String(s.host) !== String(req.user._id)) throw ApiError.forbidden();

  const { question, options } = req.body || {};
  if (!question || !Array.isArray(options) || options.length < 2)
    throw ApiError.badRequest("invalid poll");

  s.polls.push({
    question,
    options: options.map((text) => ({ text, votes: 0 })),
  });
  await s.save();

  const poll = s.polls[s.polls.length - 1];
  req.app.get("io")?.to(`live:${s.roomId}`).emit("live:poll", poll);
  res.status(201).json({ poll });
});

// ────────────────────────────────────────────────────────
// POLL — vote
// ────────────────────────────────────────────────────────
exports.votePoll = asyncHandler(async (req, res) => {
  const { optionIndex } = req.body || {};
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();

  const poll = s.polls.id(req.params.pollId);
  if (!poll) throw ApiError.notFound("poll");
  if (poll.voters.some((u) => String(u) === String(req.user._id)))
    throw ApiError.badRequest("already voted");
  if (!poll.options[optionIndex]) throw ApiError.badRequest("bad option");

  poll.options[optionIndex].votes += 1;
  poll.voters.push(req.user._id);
  await s.save();

  req.app.get("io")?.to(`live:${s.roomId}`).emit("live:pollUpdate", poll);
  res.json({ poll });
});

// ────────────────────────────────────────────────────────
// SPIN THE WHEEL
// ────────────────────────────────────────────────────────
exports.spin = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();

  // Prevent spin if stream not live
  if (s.status !== "live") {
    throw ApiError.badRequest("Spin available only during live stream");
  }

  // Prevent multiple spins per user (per session)
  const alreadySpun = s.spins?.some(
    (spin) => String(spin.user) === String(req.user._id),
  );
  if (alreadySpun) {
    throw ApiError.badRequest("You already spun this session");
  }

  // Cooldown check (10 seconds)
  if (req.user.lastSpinAt && Date.now() - req.user.lastSpinAt < 10000) {
    throw ApiError.badRequest("Please wait before spinning again");
  }

  // Weighted prizes
  const prizes = [
    { label: "5% off", type: "discount", value: 5, weight: 30 },
    { label: "10% off", type: "discount", value: 10, weight: 20 },
    { label: "Free shipping", type: "shipping", value: 0, weight: 15 },
    { label: "50 coins", type: "coins", value: 50, weight: 20 },
    { label: "15% off", type: "discount", value: 15, weight: 10 },
    { label: "Try again", type: "none", value: 0, weight: 5 },
  ];

  // Weighted random selection
  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
  let rand = Math.random() * totalWeight;

  let prize;
  for (let p of prizes) {
    if (rand < p.weight) {
      prize = p;
      break;
    }
    rand -= p.weight;
  }

  // Apply discount reward
  if (prize.type === "discount") {
    const code = `LIVE${Math.floor(1000 + Math.random() * 9000)}`;
    if (!req.user.coupons) req.user.coupons = [];
    req.user.coupons.push({
      code,
      discountPct: prize.value,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    prize.code = code;
  }

  // Save cooldown + coupons
  req.user.lastSpinAt = Date.now();
  await req.user.save();

  // Award coins (if applicable)
  if (prize.type === "coins") {
    const { award } = require("../services/coinsService");
    await award(req.user._id, prize.value, "live_spin", {
      sessionId: s._id,
      prizeLabel: prize.label,
    });
  }

  // Record spin in session
  if (!s.spins) s.spins = [];
  s.spins.push({
    user: req.user._id,
    prize: prize.label,
    at: new Date(),
  });
  await s.save();

  // Emit socket event
  req.app.get("io")?.to(`live:${s.roomId}`).emit("live:spin", {
    user: req.user._id,
    prize,
  });

  res.json({ prize });
});

// ────────────────────────────────────────────────────────
// GROUP BUY — join
// ────────────────────────────────────────────────────────
exports.joinGroupBuy = asyncHandler(async (req, res) => {
  const s = await LiveSession.findById(req.params.id);
  if (!s) throw ApiError.notFound();

  if (
    !s.groupBuy.participants.some((u) => String(u) === String(req.user._id))
  ) {
    s.groupBuy.participants.push(req.user._id);
  }

  if (
    !s.groupBuy.unlocked &&
    s.groupBuy.participants.length >= s.groupBuy.threshold
  ) {
    s.groupBuy.unlocked = true;
    req.app
      .get("io")
      ?.to(`live:${s.roomId}`)
      .emit("live:groupBuyUnlocked", { discountPct: s.groupBuy.discountPct });
  }

  await s.save();
  res.json({ groupBuy: s.groupBuy });
});