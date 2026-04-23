const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  priceAtAdd: { type: Number, required: true },
}, { _id: false });

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  items: [cartItemSchema],
}, { timestamps: true });

cartSchema.methods.subtotal = function subtotal() {
  return this.items.reduce((sum, it) => sum + it.priceAtAdd * it.quantity, 0);
};

module.exports = mongoose.model('Cart', cartSchema);
