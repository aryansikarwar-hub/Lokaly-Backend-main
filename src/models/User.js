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

  // Email verification — LINK-based (legacy, still supported)
  isEmailVerified: { type: Boolean, default: false, alias: 'emailVerified' },
  emailVerificationToken: { type: String, default: null, select: false, alias: 'emailVerifyToken' },
  emailVerificationExpiresAt: { type: Date, default: null, select: false, alias: 'emailVerifyExpires' },

  // 🆕 Email verification — OTP-based (6-digit numeric)
  emailOtpHash: { type: String, default: null, select: false },           // hashed OTP, never plain
  emailOtpExpiresAt: { type: Date, default: null, select: false },         // 10 min from issue
  emailOtpAttempts: { type: Number, default: 0, select: false },           // wrong tries (max 5)
  emailOtpSentAt: { type: Date, default: null, select: false },            // for 60s cooldown
  emailOtpSendCount: { type: Number, default: 0, select: false },          // for 10-min window cap
  emailOtpWindowStartedAt: { type: Date, default: null, select: false },   // start of 10-min window

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
  if (this.role === 'seller' && this.isVerifiedSeller) {
    if (!this.isEmailVerified || (Number(this.trustScore) || 0) <= 60) {
      this.isVerifiedSeller = false;
    }
  }
  next();
});

userSchema.post("save", async function postSave(doc) {
  // Only sync when a seller's location actually changed.
  // We can't easily check `isModified` in a post hook, so we just sync
  // unconditionally for sellers — it's a single updateMany, very cheap.
  if (doc.role !== "seller") return;
  if (
    !doc.location ||
    !doc.location.geo ||
    !Array.isArray(doc.location.geo.coordinates)
  )
    return;
  if (doc.location.geo.coordinates.length !== 2) return;

  try {
    // Lazy require to avoid circular dependency between User and Product.
    const Product = require("./Product");
    await Product.syncSellerLocation(doc._id, doc.location);
  } catch (err) {
    // Don't fail the user save just because product sync hiccupped.
    // eslint-disable-next-line no-console
    console.warn("[User postSave] product location sync failed:", err.message);
  }
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
  // 🆕 Strip OTP fields
  delete obj.emailOtpHash;
  delete obj.emailOtpExpiresAt;
  delete obj.emailOtpAttempts;
  delete obj.emailOtpSentAt;
  delete obj.emailOtpSendCount;
  delete obj.emailOtpWindowStartedAt;
  return obj;
};

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);