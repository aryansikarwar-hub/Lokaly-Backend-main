const mongoose = require('mongoose');

const coHostBookingSchema = new mongoose.Schema({
  coHost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CoHost',
    required: true,
    index: true,
  },
  bookedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Schedule
  scheduledAt: { type: Date, required: true, index: true },
  duration: { type: Number, default: 60, min: 15 }, // minutes
  endsAt: { type: Date }, // computed in pre-save

  // Pricing
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR' },

  // Status flow: pending → confirmed → in-progress → completed | cancelled | no-show
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'],
    default: 'pending',
    index: true,
  },

  // Live stream (Agora) — populated when stream starts
  streamRoomId: { type: String },          // Agora channel name
  streamToken:  { type: String },          // ephemeral, regenerated on join
  streamStartedAt: { type: Date },
  streamEndedAt:   { type: Date },

  // Payment (Razorpay) — wire up later in your existing razorpay flow
  payment: {
    orderId:   { type: String },
    paymentId: { type: String },
    signature: { type: String },
    status: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded', 'failed'],
      default: 'unpaid',
    },
    paidAt: { type: Date },
  },

  notes: { type: String, maxlength: 500 },

  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: { type: Date },
  cancelReason: { type: String, maxlength: 200 },

}, { timestamps: true });

// Compute endsAt on save (used for overlap detection)
coHostBookingSchema.pre('save', function (next) {
  if (this.scheduledAt && this.duration) {
    this.endsAt = new Date(this.scheduledAt.getTime() + this.duration * 60_000);
  }
  next();
});

// Compound index for fast conflict lookup
coHostBookingSchema.index({ coHost: 1, scheduledAt: 1, endsAt: 1, status: 1 });

module.exports = mongoose.model('CoHostBooking', coHostBookingSchema);