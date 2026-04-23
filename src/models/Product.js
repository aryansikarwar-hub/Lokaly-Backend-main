const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  slug: { type: String, trim: true, index: true },
  description: { type: String, default: '', maxlength: 5000 },
  category: { type: String, trim: true, index: true },
  tags: [{ type: String, trim: true, lowercase: true }],

  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0 },
  currency: { type: String, default: 'INR' },
  stock: { type: Number, default: 0, min: 0 },

  images: [{ url: String, publicId: String }],
  videos: [{ url: String, publicId: String }],

  attributes: { type: Map, of: String, default: {} }, // color, size, material...

  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0 },
  salesCount: { type: Number, default: 0 },

  isActive: { type: Boolean, default: true },
  isFlashDeal: { type: Boolean, default: false },
  flashDealEndsAt: { type: Date },

  // Semantic search cache (populated by ML service; see T16)
  embedding: { type: [Number], select: false },
  embeddingUpdatedAt: { type: Date, select: false },
}, { timestamps: true });

productSchema.index({ title: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, price: 1 });
productSchema.index({ seller: 1, isActive: 1 });

productSchema.pre('save', function preSave(next) {
  if (this.isModified('title') && !this.slug) {
    this.slug = this.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
