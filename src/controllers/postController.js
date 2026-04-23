const Post = require('../models/Post');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

function extractHashtags(text = '') {
  return [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.slice(1).toLowerCase()))];
}

exports.feed = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, authorId, hashtag } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(30, Math.max(1, parseInt(limit, 10)));

  const filter = { visibility: 'public' };
  if (authorId) filter.author = authorId;
  if (hashtag) filter.hashtags = hashtag.toLowerCase();

  const items = await Post.find(filter)
    .sort({ createdAt: -1 })
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .populate('author', 'name shopName avatar trustScore isVerifiedSeller role')
    .populate('taggedProducts', 'title price images slug');

  res.json({ items, page: pageNum, limit: limitNum });
});

exports.create = asyncHandler(async (req, res) => {
  const { caption = '', media = [], taggedProducts = [], kind = 'photo' } = req.body || {};
  const post = await Post.create({
    author: req.user._id,
    caption,
    media,
    taggedProducts,
    kind,
    hashtags: extractHashtags(caption),
  });
  await post.populate('author', 'name shopName avatar');
  res.status(201).json({ post });
});

exports.getById = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id)
    .populate('author', 'name shopName avatar trustScore')
    .populate('taggedProducts', 'title price images slug')
    .populate('comments.user', 'name avatar');
  if (!post) throw ApiError.notFound('Post not found');
  res.json({ post });
});

exports.like = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');
  const uid = req.user._id.toString();
  const idx = post.likes.findIndex((x) => x.toString() === uid);
  if (idx >= 0) post.likes.splice(idx, 1);
  else post.likes.push(req.user._id);
  await post.save();
  res.json({ liked: idx < 0, likeCount: post.likes.length });
});

exports.comment = asyncHandler(async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) throw ApiError.badRequest('text required');
  const post = await Post.findById(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');

  let moderation = { flagged: false, sentiment: 'NEUTRAL' };
  try {
    const { moderateText } = require('../services/moderationService');
    moderation = await moderateText(text);
  } catch (_) { /* moderation optional until T18 lands */ }

  post.comments.push({ user: req.user._id, text: text.trim(), moderation });
  await post.save();
  await post.populate('comments.user', 'name avatar');
  res.status(201).json({ comment: post.comments[post.comments.length - 1] });
});

exports.share = asyncHandler(async (req, res) => {
  const post = await Post.findByIdAndUpdate(req.params.id, { $inc: { shares: 1 } }, { new: true });
  if (!post) throw ApiError.notFound('Post not found');
  res.json({ shares: post.shares });
});

exports.remove = asyncHandler(async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) throw ApiError.notFound('Post not found');
  if (String(post.author) !== String(req.user._id) && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your post');
  }
  await post.deleteOne();
  res.json({ ok: true });
});
