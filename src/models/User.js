const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['buyer', 'seller', 'admin'];

const locationSchema = new mongoose.Schema({
  street: { type: String, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  pincode: { type: String, trim: true },
  country: { type: String, trim: true },
  geo: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] },
  },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true },
  passwordHash: { type: String, required: true, select: false },

  role: { type: String, enum: ROLES, default: 'buyer', index: true },
  avatar: { type: String, default: '' },
  bio: { type: String, maxlength: 500, default: '' },

  location: { type: locationSchema, default: () => ({}) },
  language: { type: String, default: 'en' },

  // Seller fields
  shopName: { type: String, trim: true },
  shopCategory: { type: String, trim: true },
  isVerifiedSeller: { type: Boolean, default: false },

  // Email verification (task 3 — names per spec; legacy aliases kept for back-compat)
  isEmailVerified: { type: Boolean, default: false, alias: 'emailVerified' },
  emailVerificationToken: { type: String, default: null, select: false, alias: 'emailVerifyToken' },
  emailVerificationExpiresAt: { type: Date, default: null, select: false, alias: 'emailVerifyExpires' },

  // Karma / Trust
  trustScore: { type: Number, default: 50, min: 0, max: 100 },
  fraudKarma: { type: Number, default: 50, min: 0, max: 100 },

  // Coins + referrals
  coins: { type: Number, default: 0 },
  referralCode: { type: String, unique: true, sparse: true, index: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Soft flags
  isActive: { type: Boolean, default: true },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

userSchema.index({ 'location.geo': '2dsphere' });

userSchema.pre('save', async function preSave(next) {
  if (this.isModified('passwordHash') && !this.passwordHash.startsWith('$2')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
  }
  if (!this.referralCode) {
    this.referralCode = `LKY-${this._id.toString().slice(-6).toUpperCase()}`;
  }
  // Only auto-demote once profile drops below bar; never auto-promote here
  // (maybeAutoVerifySeller is the canonical promotion path — called after trust recompute).
  if (this.role === 'seller' && this.isVerifiedSeller) {
    if (!this.isEmailVerified || (Number(this.trustScore) || 0) <= 60) {
      this.isVerifiedSeller = false;
    }
  }
  next();
});

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublic = function toPublic() {
  const obj = this.toObject({ virtuals: true });
  delete obj.passwordHash;
  delete obj.__v;
  delete obj.emailVerificationToken;
  delete obj.emailVerifyToken;
  delete obj.emailVerificationExpiresAt;
  delete obj.emailVerifyExpires;
  return obj;
};

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
