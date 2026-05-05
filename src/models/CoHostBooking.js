const mongoose = require('mongoose');

const coHostBookingSchema = new mongoose.Schema({
  coHost: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CoHost',
    required: true,
  },
  bookedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  liveSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LiveSession',
  },
  
  scheduledAt: { type: Date, required: true },
  duration: { type: Number, default: 60 }, // minutes
  amount: { type: Number, required: true },
  
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled', 'refunded'],
    default: 'pending',
  },
  
  // Payment
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending',
  },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  
  notes: { type: String }, // Special requests from booker
  
  // Review
  reviewed: { type: Boolean, default: false },
  
}, { timestamps: true });

coHostBookingSchema.index({ coHost: 1, scheduledAt: 1 });
coHostBookingSchema.index({ bookedBy: 1 });

module.exports = mongoose.model('CoHostBooking', coHostBookingSchema);