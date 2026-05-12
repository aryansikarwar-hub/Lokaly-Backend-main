// models/Post.js
const mongoose = require("mongoose");

const MediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    kind: { type: String, enum: ["image", "video"], default: "image" },
    width: Number,
    height: Number,
    duration: Number, // seconds, for video
  },
  { _id: false }
);

const PostSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["photo", "video", "text"], default: "photo", index: true },
    caption: { type: String, default: "", maxlength: 2200 },
    media: { type: [MediaSchema], default: [] },
    thumbnail: { type: String, default: "" }, // explicit cover for reels
    hashtags: { type: [String], default: [], index: true },

    // Engagement
    likes: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    likeCount: { type: Number, default: 0, index: true },
    commentCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    savedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },

    // Metadata
    location: { type: String, default: "" },
    music: { type: String, default: "" },
    privacy: { type: String, enum: ["public", "followers", "private"], default: "public", index: true },
    taggedProducts: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] },

    isPinned: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Extract hashtags from caption automatically
PostSchema.pre("save", function (next) {
  if (this.isModified("caption") && this.caption) {
    const matches = this.caption.match(/#([\w\u0900-\u097F]+)/g) || [];
    this.hashtags = [...new Set(matches.map((t) => t.slice(1).toLowerCase()))];
  }
  if (this.isModified("likes")) {
    this.likeCount = this.likes.length;
  }
  next();
});

PostSchema.index({ createdAt: -1 });
PostSchema.index({ author: 1, createdAt: -1 });
PostSchema.index({ hashtags: 1, createdAt: -1 });

// Virtual: savedByMe (populated in controller per-request)
PostSchema.set("toJSON", {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("Post", PostSchema);

// =====================================================
// models/Comment.js
// =====================================================
const CommentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 500 },
    likes: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CommentSchema.index({ post: 1, createdAt: -1 });

module.exports.Comment = mongoose.model("Comment", CommentSchema);