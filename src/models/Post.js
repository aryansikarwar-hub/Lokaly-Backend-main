const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 800 },
  moderation: {
    flagged: { type: Boolean, default: false },
    sentiment: { type: String, enum: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'], default: 'NEUTRAL' },
  },
  createdAt: { type: Date, default: Date.now },
});

const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['photo', 'video', 'reel'], default: 'photo' },
  caption: { type: String, maxlength: 1000, default: '' },
  media: [{ url: String, publicId: String, kind: { type: String, enum: ['image', 'video'] } }],
  taggedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  comments: [commentSchema],
  shares: { type: Number, default: 0 },

  hashtags: [{ type: String, lowercase: true, trim: true }],
  visibility: { type: String, enum: ['public', 'followers'], default: 'public' },
}, { timestamps: true });

postSchema.index({ createdAt: -1 });
postSchema.index({ hashtags: 1, createdAt: -1 });

postSchema.virtual('likeCount').get(function likeCount() { return this.likes.length; });
postSchema.virtual('commentCount').get(function commentCount() { return this.comments.length; });
postSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Post', postSchema);
