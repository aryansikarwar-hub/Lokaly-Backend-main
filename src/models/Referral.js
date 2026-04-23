const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referredSeller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  status: { type: String, enum: ['pending', 'qualified'], default: 'pending', index: true },

  // Total seller GMV accumulated since signup (gates qualification at ₹10,000).
  gmv: { type: Number, default: 0 },
  qualifiedAt: Date,

  // Lifetime 2% equity cashback tracker
  cashbackRate: { type: Number, default: 0.02 },
  cashbackPaidTotal: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Referral', referralSchema);
