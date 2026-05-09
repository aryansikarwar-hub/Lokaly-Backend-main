const mongoose = require("mongoose");

/**
 * Denormalized seller location lives on the product itself.
 * Why: lets us run a single $geoNear stage on `products` without
 * a $lookup-per-doc. Kept in sync via Product.syncSellerLocation()
 * below + a hook on the User model when a seller updates location.
 */
const sellerLocationSchema = new mongoose.Schema(
  {
    city: { type: String, trim: true },
    pincode: { type: String, trim: true },
    geo: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined },
    },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, trim: true, index: true },
    description: { type: String, default: "", maxlength: 5000 },
    category: { type: String, trim: true, index: true },
    tags: [{ type: String, trim: true, lowercase: true }],

    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    currency: { type: String, default: "INR" },
    stock: { type: Number, default: 0, min: 0 },

    images: [{ url: String, publicId: String }],
    videos: [{ url: String, publicId: String }],

    attributes: { type: Map, of: String, default: {} },

    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    salesCount: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
    isFlashDeal: { type: Boolean, default: false },
    flashDealEndsAt: { type: Date },

    // ─── HYPERLOCAL ADDITIONS ──────────────────────────────────────────
    sellerLocation: { type: sellerLocationSchema, default: undefined },
    // How far this product can be delivered. Default 25km covers most metro
    // hyperlocal use-cases. Set to a large number (e.g. 5000) for nation-wide.
    deliveryRadiusKm: { type: Number, default: 25, min: 0, max: 5000 },

    // Trending signals — cheap to maintain, no separate collection needed.
    viewCount: { type: Number, default: 0 },
    // Rolling 7-day view counts bucketed by date string (YYYY-MM-DD).
    // Keeping it lean: only the last 7 entries are retained on increment.
    viewsByDay: [
      {
        date: String,
        count: { type: Number, default: 0 },
      },
    ],
    // ───────────────────────────────────────────────────────────────────

    embedding: { type: [Number], select: false },
    embeddingUpdatedAt: { type: Date, select: false },
  },
  { timestamps: true },
);

productSchema.index({ title: "text", description: "text", tags: "text" });
productSchema.index({ category: 1, price: 1 });
productSchema.index({ seller: 1, isActive: 1 });
// 2dsphere on the denormalized seller location — this is the magic index
// that powers $geoNear on /api/hyperlocal/products/nearby.
productSchema.index({ "sellerLocation.geo": "2dsphere" }, { sparse: true });
productSchema.index({ "sellerLocation.pincode": 1, isActive: 1 });

productSchema.pre("save", function preSave(next) {
  if (this.isModified("title") && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
  next();
});

/**
 * Bulk-sync seller location onto all of a seller's products.
 * Call this from the User model post-save hook (or admin script).
 */
productSchema.statics.syncSellerLocation = async function syncSellerLocation(
  sellerId,
  location,
) {
  if (!sellerId || !location) return { matched: 0, modified: 0 };
  const update = {
    "sellerLocation.city": location.city || "",
    "sellerLocation.pincode": location.pincode || "",
  };
  if (
    location.geo &&
    Array.isArray(location.geo.coordinates) &&
    location.geo.coordinates.length === 2
  ) {
    update["sellerLocation.geo"] = {
      type: "Point",
      coordinates: location.geo.coordinates,
    };
  }
  const res = await this.updateMany({ seller: sellerId }, { $set: update });
  return { matched: res.matchedCount, modified: res.modifiedCount };
};

/**
 * Increment view count + today's bucket. Idempotent-safe enough for
 * trending purposes (we don't dedupe per user — that's overkill at this stage).
 */
productSchema.statics.incrementView = async function incrementView(productId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const doc = await this.findById(productId).select("viewsByDay");
  if (!doc) return null;
  const idx = (doc.viewsByDay || []).findIndex((v) => v.date === today);
  if (idx >= 0) {
    return this.updateOne(
      { _id: productId, "viewsByDay.date": today },
      { $inc: { viewCount: 1, "viewsByDay.$.count": 1 } },
    );
  }
  // Push today's bucket and trim to last 7 days.
  return this.updateOne(
    { _id: productId },
    {
      $inc: { viewCount: 1 },
      $push: {
        viewsByDay: {
          $each: [{ date: today, count: 1 }],
          $slice: -7,
        },
      },
    },
  );
};

module.exports = mongoose.model("Product", productSchema);
