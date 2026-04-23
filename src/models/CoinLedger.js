const mongoose = require('mongoose');

const COIN_REASONS = [
  'review', 'helpful_answer', 'live_spin', 'live_game',
  'order_reward', 'referral_bonus', 'equity_cashback',
  'order_redeem', 'admin_adjust', 'coin_expiry', 'expiry',
];

// Spec: positive coin grants expire in 180 days; negatives/redemptions never expire.
const COIN_EXPIRY_DAYS = 180;
const COIN_EXPIRY_MS = COIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

const coinLedgerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  delta: { type: Number, required: true }, // +earn / -redeem
  reason: { type: String, enum: COIN_REASONS, required: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  balanceAfter: Number,
  // Positive deltas: default to createdAt + 180 days. Negatives/redemptions: null.
  expiresAt: { type: Date, default: null, index: true },
  expiredAt: { type: Date, default: null },
  // Set true once this earn row has been fully offset by redemptions / expiry write-offs.
  expired: { type: Boolean, default: false, index: true },
}, { timestamps: true });

coinLedgerSchema.pre('validate', function preValidate(next) {
  if (this.isNew && this.delta > 0 && !this.expiresAt && this.reason !== 'coin_expiry') {
    this.expiresAt = new Date(Date.now() + COIN_EXPIRY_MS);
  }
  next();
});

coinLedgerSchema.index({ user: 1, createdAt: -1 });
coinLedgerSchema.index({ expiresAt: 1, expired: 1, delta: 1 });
coinLedgerSchema.statics.REASONS = COIN_REASONS;
coinLedgerSchema.statics.COIN_EXPIRY_DAYS = COIN_EXPIRY_DAYS;

module.exports = mongoose.model('CoinLedger', coinLedgerSchema);
