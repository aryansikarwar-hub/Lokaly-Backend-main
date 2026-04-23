const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessage: {
    text: String,
    at: Date,
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  unread: { type: Map, of: Number, default: {} }, // userId -> unread count
}, { timestamps: true });

conversationSchema.index({ participants: 1, updatedAt: -1 });

conversationSchema.statics.between = async function between(a, b) {
  const ids = [a, b].sort();
  let convo = await this.findOne({ participants: { $all: ids, $size: 2 } });
  if (!convo) convo = await this.create({ participants: ids });
  return convo;
};

module.exports = mongoose.model('Conversation', conversationSchema);
