// routes/posts.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Post = require("../models/Post");
const { Comment } = require("../models/Post"); // adjust if separate file

// ============ AUTH MIDDLEWARE ============
// ✅ Real JWT auth middleware
const { requireAuth } = require('../middleware/auth');

const optionalAuth = (req, res, next) => next();

// ============ HELPERS ============
// Normalize a media/thumbnail URL before saving to DB
// Strips localhost origin (dev artifact), fixes missing leading slash
function normalizeUrl(url) {
  if (!url || typeof url !== "string") return url;
  // Keep data: URLs (base64 thumbnails from frame extraction) as-is
  if (url.startsWith("data:")) return url;
  // Strip http://localhost:PORT prefix (dev artifact stored in old posts)
  url = url.replace(/^https?:\/\/localhost:\d+/i, "");
  // Already a clean absolute URL (Cloudinary, S3, etc.)
  if (/^https?:\/\//i.test(url)) return url;
  // Has no leading slash but is not http → could be:
  //   "uploads/filename.mp4"  → add leading /
  //   "filename.mp4"          → bare filename, add /uploads/ prefix
  if (!url.startsWith("/")) {
    if (url.startsWith("uploads/")) {
      url = "/" + url; // "uploads/f.mp4" → "/uploads/f.mp4"
    } else {
      url = "/uploads/" + url; // "f.mp4" → "/uploads/f.mp4"
    }
  }
  return url;
}

function sanitizeMedia(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((m) => m && typeof m.url === "string" && m.url.length > 0)
    .map((m) => ({
      url: normalizeUrl(m.url),
      kind: m.kind === "video" ? "video" : "image",
      width: Number(m.width) || undefined,
      height: Number(m.height) || undefined,
      duration: Number(m.duration) || undefined,
    }));
}

function decorate(post, userId) {
  if (!post) return null;
  const obj = post.toObject ? post.toObject() : post;
  obj.savedByMe = userId ? (obj.savedBy || []).some((id) => String(id) === String(userId)) : false;
  obj.likedByMe = userId ? (obj.likes || []).some((id) => String(id) === String(userId)) : false;
  // Don't leak full savedBy list
  delete obj.savedBy;
  // ✅ Normalize all media URLs from DB (fixes legacy http://localhost:PORT/uploads/...
  // and bare "filename.jpg" stored from old backend versions)
  if (Array.isArray(obj.media)) {
    obj.media = obj.media.map((m) => m ? { ...m, url: normalizeUrl(m.url) } : m);
  }
  if (obj.thumbnail) {
    obj.thumbnail = normalizeUrl(obj.thumbnail);
  }
  if (obj.author?.avatar) {
    obj.author = { ...obj.author, avatar: normalizeUrl(obj.author.avatar) };
  }
  return obj;
}

// ============ GET /posts  (feed list) ============
router.get("/", optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 12);
    const skip = (page - 1) * limit;

    const query = { isDeleted: false, privacy: "public" };

    if (req.query.hashtag) {
      query.hashtags = req.query.hashtag.toLowerCase();
    }
    if (req.query.author) {
      query.author = req.query.author;
    }

    // Filter logic
    let sort = { createdAt: -1 };
    if (req.query.filter === "trending") {
      sort = { likeCount: -1, createdAt: -1 };
      // last 7 days
      query.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
    } else if (req.query.filter === "following" && req.user?.following) {
      query.author = { $in: req.user.following };
    }

    const [items, total] = await Promise.all([
      Post.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("author", "name avatar isVerified")
        .lean(),
      Post.countDocuments(query),
    ]);

    const decorated = items.map((p) => decorate(p, req.user?._id));
    res.json({
      items: decorated,
      page,
      limit,
      total,
      hasMore: skip + items.length < total,
    });
  } catch (err) {
    console.error("Feed list error:", err);
    res.status(500).json({ error: "Feed load fail" });
  }
});

// ============ GET /posts/:id (single) ============
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false })
      .populate("author", "name avatar isVerified");
    if (!post) return res.status(404).json({ error: "Post nahi mili" });

    // Increment view count async (don't await)
    Post.updateOne({ _id: post._id }, { $inc: { views: 1 } }).catch(() => {});

    res.json({ post: decorate(post, req.user?._id) });
  } catch (err) {
    console.error("Get post error:", err);
    res.status(500).json({ error: "Failed" });
  }
});

// ============ POST /posts  (create) ============
router.post("/", requireAuth, async (req, res) => {
  try {
    const { caption = "", kind = "photo", media = [], thumbnail, location, music, privacy, taggedProducts } = req.body;

    const cleanMedia = sanitizeMedia(media);
    const validKind = ["photo", "video", "text"].includes(kind) ? kind : "photo";

    // DEBUG: log exactly what arrived
    console.log("[POST /posts] kind:", kind, "| media count:", media?.length, "| cleanMedia:", JSON.stringify(cleanMedia?.slice(0,2)));

    // Validation
    if (validKind === "video" && !cleanMedia.some((m) => m.kind === "video")) {
      console.log("[POST /posts] 400: video required. Received media:", JSON.stringify(media));
      return res.status(400).json({ error: "Video required for reel. Media received: " + JSON.stringify(media?.slice(0,1)) });
    }
    if (validKind === "photo" && cleanMedia.length === 0 && !caption.trim()) {
      return res.status(400).json({ error: "Photo ya caption zaroori hai" });
    }

    const post = await Post.create({
      author: req.user._id,
      kind: validKind,
      caption: caption.slice(0, 2200),
      media: cleanMedia,
      thumbnail: typeof thumbnail === "string" ? normalizeUrl(thumbnail) : "",
      location: typeof location === "string" ? location.slice(0, 100) : "",
      music: typeof music === "string" ? music.slice(0, 100) : "",
      privacy: ["public", "followers", "private"].includes(privacy) ? privacy : "public",
      taggedProducts: Array.isArray(taggedProducts) ? taggedProducts.filter(mongoose.isValidObjectId) : [],
    });

    await post.populate("author", "name avatar isVerified");
    res.status(201).json({ post: decorate(post, req.user._id) });
  } catch (err) {
    console.error("Create post error:", err);
    res.status(500).json({ error: err.message || "Post create fail" });
  }
});

// ============ PATCH /posts/:id  (edit) ============
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });
    if (String(post.author) !== String(req.user._id)) {
      return res.status(403).json({ error: "Sirf owner edit kar sakta hai" });
    }

    const { caption, location, music, privacy, thumbnail } = req.body;
    if (typeof caption === "string") post.caption = caption.slice(0, 2200);
    if (typeof location === "string") post.location = location.slice(0, 100);
    if (typeof music === "string") post.music = music.slice(0, 100);
    if (typeof thumbnail === "string") post.thumbnail = thumbnail;
    if (["public", "followers", "private"].includes(privacy)) post.privacy = privacy;

    await post.save();
    await post.populate("author", "name avatar isVerified");
    res.json({ post: decorate(post, req.user._id) });
  } catch (err) {
    console.error("Edit error:", err);
    res.status(500).json({ error: "Update fail" });
  }
});

// ============ DELETE /posts/:id ============
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });
    if (String(post.author) !== String(req.user._id)) {
      return res.status(403).json({ error: "Sirf owner delete kar sakta hai" });
    }
    post.isDeleted = true;
    await post.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Delete fail" });
  }
});

// ============ POST /posts/:id/like  (toggle) ============
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });

    const userId = req.user._id;
    const idx = post.likes.findIndex((id) => String(id) === String(userId));
    let liked;
    if (idx >= 0) { post.likes.splice(idx, 1); liked = false; }
    else { post.likes.push(userId); liked = true; }

    post.likeCount = post.likes.length;
    await post.save();
    res.json({ liked, likeCount: post.likeCount });
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).json({ error: "Like fail" });
  }
});

// ============ POST /posts/:id/save  (toggle) ============
router.post("/:id/save", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });

    const userId = req.user._id;
    const idx = post.savedBy.findIndex((id) => String(id) === String(userId));
    let saved;
    if (idx >= 0) { post.savedBy.splice(idx, 1); saved = false; }
    else { post.savedBy.push(userId); saved = true; }

    await post.save();
    res.json({ saved });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: "Save fail" });
  }
});

// ============ GET /posts/:id/comments ============
router.get("/:id/comments", optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const items = await Comment.find({ post: req.params.id, isDeleted: false, parent: null })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("author", "name avatar isVerified")
      .lean();

    res.json({ items, page, limit });
  } catch (err) {
    console.error("Get comments error:", err);
    res.status(500).json({ error: "Comments load fail" });
  }
});

// ============ POST /posts/:id/comments ============
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const { text, parent } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Text required" });

    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });

    const comment = await Comment.create({
      post: post._id,
      author: req.user._id,
      text: text.trim().slice(0, 500),
      parent: mongoose.isValidObjectId(parent) ? parent : null,
    });

    post.commentCount = (post.commentCount || 0) + 1;
    await post.save();

    await comment.populate("author", "name avatar isVerified");
    res.status(201).json({ comment });
  } catch (err) {
    console.error("Comment error:", err);
    res.status(500).json({ error: "Comment fail" });
  }
});

// ============ DELETE /posts/:postId/comments/:commentId ============
router.delete("/:postId/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const comment = await Comment.findOne({ _id: req.params.commentId, isDeleted: false });
    if (!comment) return res.status(404).json({ error: "Comment nahi mila" });
    if (String(comment.author) !== String(req.user._id)) {
      return res.status(403).json({ error: "Sirf owner delete kar sakta hai" });
    }
    comment.isDeleted = true;
    await comment.save();
    await Post.updateOne({ _id: req.params.postId }, { $inc: { commentCount: -1 } });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete comment error:", err);
    res.status(500).json({ error: "Delete fail" });
  }
});

// ============ GET /posts/trending/hashtags ============
router.get("/trending/hashtags", async (req, res) => {
  try {
    const result = await Post.aggregate([
      { $match: { isDeleted: false, privacy: "public", createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } },
      { $unwind: "$hashtags" },
      { $group: { _id: "$hashtags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);
    res.json({ items: result.map((r) => ({ tag: r._id, count: r.count })) });
  } catch (err) {
    console.error("Trending error:", err);
    res.status(500).json({ error: "Trending fail" });
  }
});

module.exports = router;