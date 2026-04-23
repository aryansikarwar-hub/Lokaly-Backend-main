const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

exports.listConversations = asyncHandler(async (req, res) => {
  const convos = await Conversation.find({ participants: req.user._id })
    .sort({ updatedAt: -1 })
    .populate('participants', 'name avatar shopName role trustScore isVerifiedSeller');
  const shaped = convos.map((c) => {
    const other = c.participants.find((p) => String(p._id) !== String(req.user._id));
    return {
      id: c._id,
      other,
      lastMessage: c.lastMessage,
      unread: c.unread?.get?.(String(req.user._id)) || 0,
      updatedAt: c.updatedAt,
    };
  });
  res.json({ conversations: shaped });
});

exports.openWith = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (String(userId) === String(req.user._id)) throw ApiError.badRequest('cannot chat with self');
  const convo = await Conversation.between(req.user._id, userId);
  await convo.populate('participants', 'name avatar shopName role trustScore');
  res.json({ conversation: convo });
});

exports.messages = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { before, limit = 30 } = req.query;
  const convo = await Conversation.findById(conversationId);
  if (!convo) throw ApiError.notFound();
  if (!convo.participants.some((p) => String(p) === String(req.user._id))) throw ApiError.forbidden();

  const q = { conversation: convo._id };
  if (before) q.createdAt = { $lt: new Date(before) };
  const messages = await Message.find(q).sort({ createdAt: -1 }).limit(Math.min(100, Number(limit)));

  // Mark my-side unread as read
  const key = String(req.user._id);
  convo.unread.set(key, 0);
  await convo.save();

  res.json({ messages: messages.reverse() });
});

exports.send = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { text = '', attachment, productRef } = req.body || {};
  if (!text && !attachment && !productRef) throw ApiError.badRequest('empty message');

  const convo = await Conversation.findById(conversationId);
  if (!convo) throw ApiError.notFound();
  if (!convo.participants.some((p) => String(p) === String(req.user._id))) throw ApiError.forbidden();

  const toUser = convo.participants.find((p) => String(p) !== String(req.user._id));

  // Moderation is best-effort. If the sentiment/moderation service throws we still
  // persist the message but mark it UNKNOWN so downstream UI can surface a warning.
  let moderation = { flagged: false, label: 'NEUTRAL', score: 0 };
  let faqSuggestion = null;
  if (text) {
    try {
      const { moderateText, suggestFaqReply } = require('../services/moderationService');
      moderation = await moderateText(text);
      try { faqSuggestion = await suggestFaqReply({ fromUser: req.user._id, toUser, text }); }
      catch (_) { /* non-fatal */ }
    } catch (err) {
      moderation = { flagged: true, label: 'UNKNOWN', score: 0 };
      // eslint-disable-next-line no-console
      console.error('[chat] moderation failed:', err.message);
    }
  }

  const msg = await Message.create({
    conversation: convo._id,
    from: req.user._id,
    to: toUser,
    text,
    attachment,
    productRef,
    moderation,
    faqSuggestion,
  });

  convo.lastMessage = { text: text || '[attachment]', at: msg.createdAt, from: req.user._id };
  const toKey = String(toUser);
  convo.unread.set(toKey, (convo.unread.get(toKey) || 0) + 1);
  await convo.save();

  // Socket emit is handled by the sockets layer (T11); this REST path is kept for fallbacks.
  const io = req.app.get('io');
  io?.to(`user:${toUser}`).emit('chat:message', msg);
  if (moderation && moderation.flagged) {
    io?.to(`user:${toUser}`).emit('chat:flagged', {
      messageId: msg._id,
      conversationId: convo._id,
      from: req.user._id,
      label: moderation.label || 'UNKNOWN',
    });
  }

  res.status(201).json({ message: msg });
});
