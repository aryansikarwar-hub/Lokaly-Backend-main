const mongoose = require("mongoose");

const flashDealSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    discountPct: { type: Number, required: true, min: 1, max: 90 },
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, required: true },
    claimedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    maxClaims: { type: Number, default: 20 },
  },
  { _id: true },
);

const pollSchema = new mongoose.Schema(
  {
    question: String,
    options: [{ text: String, votes: { type: Number, default: 0 } }],
    voters: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    closedAt: Date,
  },
  { _id: true },
);

const liveSessionSchema = new mongoose.Schema(
  {
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    coHosts: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 1000, default: "" },
    coverImage: { type: String, default: "" },
    category: String,

    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
      index: true,
    },
    scheduledAt: Date,
    startedAt: Date,
    endedAt: Date,

    streamKey: String, // Agora/LiveKit token placeholder
    roomId: String, // room identifier for socket signaling

    featuredProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    ],
    flashDeals: [flashDealSchema],
    polls: [pollSchema],

    stats: {
      peakViewers: { type: Number, default: 0 },
      totalViewers: { type: Number, default: 0 },
      reactions: { type: Number, default: 0 },
      chatMessages: { type: Number, default: 0 },
      salesAmount: { type: Number, default: 0 },
    },

    // Group-buying goal: unlock groupBuyDiscountPct + coin rewards when
    // `threshold` distinct buyers complete paid orders against this session.
    //   participants = users who clicked "Join Group Buy" (intent, unlocks the UI)
    //   buyers       = users who actually paid for an order in this session
    //   coinsAwarded = true once we've distributed coins (idempotency guard)
    groupBuy: {
      threshold: { type: Number, default: 0 },
      discountPct: { type: Number, default: 0 },
      participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      buyers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      unlocked: { type: Boolean, default: false },
      coinsAwarded: { type: Boolean, default: false },
    },

    spins: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        prize: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

liveSessionSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model("LiveSession", liveSessionSchema);
