const mongoose = require('mongoose');

const ORDER_STATUS = ['pending', 'paid', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'];

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: String,
  image: String,
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
}, { _id: false });

const addressSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  line1: String,
  line2: String,
  city: String,
  state: String,
  pincode: String,
  country: { type: String, default: 'IN' },
}, { _id: false });

const timelineEntrySchema = new mongoose.Schema({
  status: { type: String, enum: ORDER_STATUS, required: true },
  note: String,
  at: { type: Date, default: Date.now },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: [orderItemSchema],
  address: { type: addressSchema, required: true },

  subtotal: { type: Number, required: true },
  shipping: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  coinsRedeemed: { type: Number, default: 0 },
  total: { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  status: { type: String, enum: ORDER_STATUS, default: 'pending', index: true },
  timeline: [timelineEntrySchema],

  payment: {
    provider: { type: String, default: 'razorpay' },
    orderId: String,
    paymentId: String,
    signature: String,
    paidAt: Date,
    mode: String,
  },

  liveSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession' },
  coHostSplit: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  }],
}, { timestamps: true });

orderSchema.statics.STATUS = ORDER_STATUS;

orderSchema.methods.addTimeline = function addTimeline(status, note) {
  this.timeline.push({ status, note, at: new Date() });
  this.status = status;
};

module.exports = mongoose.model('Order', orderSchema);
