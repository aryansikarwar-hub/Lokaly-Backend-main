const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  attachment: { url: String, kind: { type: String, enum: ['image', 'video', 'file'] } },

  // product-tag in chat (e.g., seller pushes a product card into the conversation)
  productRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },

  readAt: Date,
  moderation: {
    flagged: { type: Boolean, default: false },
    label: String,
    score: Number,
    error: { type: Boolean, default: false },
  },
  // Smart FAQ: suggested canned reply from seller's past answers (T18)
  faqSuggestion: String,
}, { timestamps: true });

messageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
