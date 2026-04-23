const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },

  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, maxlength: 2000, default: '' },
  images: [{ url: String, publicId: String }],

  sentiment: {
    label: { type: String, enum: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'], default: 'NEUTRAL' },
    score: { type: Number, default: 0 },
  },

  helpfulVotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isRepeatBuyer: { type: Boolean, default: false },
}, { timestamps: true });

reviewSchema.index({ product: 1, createdAt: -1 });
reviewSchema.index({ seller: 1, createdAt: -1 });
reviewSchema.index({ buyer: 1, product: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
