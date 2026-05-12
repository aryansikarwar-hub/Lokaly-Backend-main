// routes/posts.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Post = require("../models/Post");
const { Comment } = require("../models/Post");

// ✅ Real JWT auth middleware
const { requireAuth } = require("../middleware/auth");
const optionalAuth = (req, res, next) => next();

// ============ HELPERS ============

// Normalize any URL format to a clean relative /uploads/filename path
function normalizeUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  // Strip http://localhost:PORT (dev artifact)
  url = url.replace(/^https?:\/\/localhost:\d+/i, "");
  // Already a clean external URL (Cloudinary, S3, render.com etc.)
  if (/^https?:\/\//i.test(url)) return url;
  // Fix missing leading slash
  if (!url.startsWith("/")) {
    url = url.startsWith("uploads/") ? "/" + url : "/uploads/" + url;
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
  obj.savedByMe = userId
    ? (obj.savedBy || []).some((id) => String(id) === String(userId))
    : false;
  obj.likedByMe = userId
    ? (obj.likes || []).some((id) => String(id) === String(userId))
    : false;
  delete obj.savedBy;
  // ✅ Normalize all URLs from DB so old posts with broken URLs display correctly
  if (Array.isArray(obj.media)) {
    obj.media = obj.media.map((m) =>
      m ? { ...m, url: normalizeUrl(m.url) } : m,
    );
  }
  if (obj.thumbnail) obj.thumbnail = normalizeUrl(obj.thumbnail);
  return obj;
}

// ============ GET /posts (feed list) ============
router.get("/", optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 12);
    const skip = (page - 1) * limit;
    const query = { isDeleted: false, privacy: "public" };
    if (req.query.hashtag) query.hashtags = req.query.hashtag.toLowerCase();
    if (req.query.author) query.author = req.query.author;

    let sort = { createdAt: -1 };
    if (req.query.filter === "trending") {
      sort = { likeCount: -1, createdAt: -1 };
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

    res.json({
      items: items.map((p) => decorate(p, req.user?._id)),
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

// ============ GET /posts/:id ============
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ error: "Invalid id" });
    const post = await Post.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).populate("author", "name avatar isVerified");
    if (!post) return res.status(404).json({ error: "Post nahi mili" });
    Post.updateOne({ _id: post._id }, { $inc: { views: 1 } }).catch(() => {});
    res.json({ post: decorate(post, req.user?._id) });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

// ============ POST /posts (create) ============
router.post("/", requireAuth, async (req, res) => {
  try {
    const {
      caption = "",
      kind = "photo",
      media = [],
      thumbnail,
      location,
      music,
      privacy,
      taggedProducts,
    } = req.body;

    const cleanMediaArr = sanitizeMedia(media);
    const validKind = ["photo", "video", "text"].includes(kind)
      ? kind
      : "photo";

    if (
      validKind === "video" &&
      !cleanMediaArr.some((m) => m.kind === "video")
    ) {
      return res.status(400).json({ error: "Video required for reel" });
    }
    if (
      validKind === "photo" &&
      cleanMediaArr.length === 0 &&
      !caption.trim()
    ) {
      return res.status(400).json({ error: "Photo ya caption zaroori hai" });
    }

    const post = await Post.create({
      author: req.user._id,
      kind: validKind,
      caption: caption.slice(0, 2200),
      media: cleanMediaArr,
      thumbnail: typeof thumbnail === "string" ? normalizeUrl(thumbnail) : "",
      location: typeof location === "string" ? location.slice(0, 100) : "",
      music: typeof music === "string" ? music.slice(0, 100) : "",
      privacy: ["public", "followers", "private"].includes(privacy)
        ? privacy
        : "public",
      taggedProducts: Array.isArray(taggedProducts)
        ? taggedProducts.filter(mongoose.isValidObjectId)
        : [],
    });

    await post.populate("author", "name avatar isVerified");
    res.status(201).json({ post: decorate(post, req.user._id) });
  } catch (err) {
    console.error("Create post error:", err);
    res.status(500).json({ error: err.message || "Post create fail" });
  }
});

// ============ PATCH /posts/:id ============
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });
    if (String(post.author) !== String(req.user._id))
      return res.status(403).json({ error: "Sirf owner edit kar sakta hai" });
    const { caption, location, music, privacy, thumbnail } = req.body;
    if (typeof caption === "string") post.caption = caption.slice(0, 2200);
    if (typeof location === "string") post.location = location.slice(0, 100);
    if (typeof music === "string") post.music = music.slice(0, 100);
    if (typeof thumbnail === "string") post.thumbnail = normalizeUrl(thumbnail);
    if (["public", "followers", "private"].includes(privacy))
      post.privacy = privacy;
    await post.save();
    await post.populate("author", "name avatar isVerified");
    res.json({ post: decorate(post, req.user._id) });
  } catch (err) {
    res.status(500).json({ error: "Update fail" });
  }
});

// ============ DELETE /posts/:id ============
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });
    if (String(post.author) !== String(req.user._id))
      return res.status(403).json({ error: "Sirf owner delete kar sakta hai" });
    post.isDeleted = true;
    await post.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Delete fail" });
  }
});

// ============ POST /posts/:id/like ============
router.post("/:id/like", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });
    const userId = req.user._id;
    const idx = post.likes.findIndex((id) => String(id) === String(userId));
    let liked;
    if (idx >= 0) {
      post.likes.splice(idx, 1);
      liked = false;
    } else {
      post.likes.push(userId);
      liked = true;
    }
    post.likeCount = post.likes.length;
    await post.save();
    res.json({ liked, likeCount: post.likeCount });
  } catch (err) {
    res.status(500).json({ error: "Like fail" });
  }
});

// ============ POST /posts/:id/save ============
router.post("/:id/save", requireAuth, async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, isDeleted: false });
    if (!post) return res.status(404).json({ error: "Post nahi mili" });
    const userId = req.user._id;
    const idx = post.savedBy.findIndex((id) => String(id) === String(userId));
    let saved;
    if (idx >= 0) {
      post.savedBy.splice(idx, 1);
      saved = false;
    } else {
      post.savedBy.push(userId);
      saved = true;
    }
    await post.save();
    res.json({ saved });
  } catch (err) {
    res.status(500).json({ error: "Save fail" });
  }
});

// ============ GET /posts/:id/comments ============
router.get("/:id/comments", optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;
    const items = await Comment.find({
      post: req.params.id,
      isDeleted: false,
      parent: null,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("author", "name avatar isVerified")
      .lean();
    res.json({ items, page, limit });
  } catch (err) {
    res.status(500).json({ error: "Comments load fail" });
  }
});

// ============ POST /posts/:id/comments ============
router.post("/:id/comments", requireAuth, async (req, res) => {
  try {
    const { text, parent } = req.body;
    if (!text || !text.trim())
      return res.status(400).json({ error: "Text required" });
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
    res.status(500).json({ error: "Comment fail" });
  }
});

// ============ DELETE /posts/:postId/comments/:commentId ============
router.delete("/:postId/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const comment = await Comment.findOne({
      _id: req.params.commentId,
      isDeleted: false,
    });
    if (!comment) return res.status(404).json({ error: "Comment nahi mila" });
    if (String(comment.author) !== String(req.user._id))
      return res.status(403).json({ error: "Sirf owner delete kar sakta hai" });
    comment.isDeleted = true;
    await comment.save();
    await Post.updateOne(
      { _id: req.params.postId },
      { $inc: { commentCount: -1 } },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Delete fail" });
  }
});

// ============ GET /posts/trending/hashtags ============
router.get("/trending/hashtags", async (req, res) => {
  try {
    const result = await Post.aggregate([
      {
        $match: {
          isDeleted: false,
          privacy: "public",
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
        },
      },
      { $unwind: "$hashtags" },
      { $group: { _id: "$hashtags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);
    res.json({ items: result.map((r) => ({ tag: r._id, count: r.count })) });
  } catch (err) {
    res.status(500).json({ error: "Trending fail" });
  }
});

module.exports = router;
