const mongoose = require('mongoose');

const flashDealSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  discountPct: { type: Number, required: true, min: 1, max: 90 },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, required: true },
  claimedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxClaims: { type: Number, default: 20 },
}, { _id: true });

const pollSchema = new mongoose.Schema({
  question: String,
  options: [{ text: String, votes: { type: Number, default: 0 } }],
  voters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  closedAt: Date,
}, { _id: true });

const liveSessionSchema = new mongoose.Schema({
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  coHosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  title: { type: String, required: true, maxlength: 120 },
  description: { type: String, maxlength: 1000, default: '' },
  coverImage: String,
  category: String,

  status: { type: String, enum: ['scheduled', 'live', 'ended'], default: 'scheduled', index: true },
  scheduledAt: Date,
  startedAt: Date,
  endedAt: Date,

  streamKey: String,   // Agora/LiveKit token placeholder
  roomId: String,      // room identifier for socket signaling

  featuredProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  flashDeals: [flashDealSchema],
  polls: [pollSchema],

  stats: {
    peakViewers: { type: Number, default: 0 },
    totalViewers: { type: Number, default: 0 },
    reactions: { type: Number, default: 0 },
    chatMessages: { type: Number, default: 0 },
    salesAmount: { type: Number, default: 0 },
  },

  // Group-buying goal: unlock groupBuyDiscountPct when groupBuyThreshold buyers add cart
  groupBuy: {
    threshold: { type: Number, default: 0 },
    discountPct: { type: Number, default: 0 },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    unlocked: { type: Boolean, default: false },
  },
}, { timestamps: true });

liveSessionSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model('LiveSession', liveSessionSchema);
