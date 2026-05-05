const mongoose = require('mongoose');

const coHostSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  name: { type: String, required: true },
  bio: { type: String, maxlength: 500 },
  profileImage: { type: String }, // Cloudinary URL
  location: {
    city: { type: String, required: true },
    state: { type: String },
  },
  category: {
    type: String,
    enum: ['Sarees', 'Pottery', 'Jewellery', 'Spices', 'Ethnic Wear', 'Madhubani Art', 'Other'],
    required: true,
  },
  specialty: { type: String, required: true }, // e.g. "Handloom & Sarees"
  languages: [{
    type: String,
    enum: ['HI', 'EN', 'TA', 'TE', 'ML', 'BN', 'PA', 'GU', 'MR', 'KN'],
  }],
  perStreamRate: { type: Number, required: true, min: 0 },
  
  // Stats
  streamsHosted: { type: Number, default: 0 },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  totalReviews: { type: Number, default: 0 },
  karmaScore: { type: Number, default: 50 }, // 0-100
  
  // Status
  isAvailable: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  
  // Verification
  verificationDocs: [{ type: String }], // Cloudinary URLs
  verifiedAt: { type: Date },
  
  // Bookings
  totalBookings: { type: Number, default: 0 },
  completedBookings: { type: Number, default: 0 },
  cancelledBookings: { type: Number, default: 0 },
  
}, { timestamps: true });

// Indexes for fast filtering
coHostSchema.index({ category: 1, isAvailable: 1 });
coHostSchema.index({ 'location.city': 1 });
coHostSchema.index({ rating: -1 });

module.exports = mongoose.model('CoHost', coHostSchema);