const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

module.exports = function chatHandlers(io, socket) {
  if (!socket.userId) return;

  socket.on('chat:typing', ({ conversationId, isTyping }) => {
    socket.to(`convo:${conversationId}`).emit('chat:typing', { conversationId, from: socket.userId, isTyping });
  });

  socket.on('chat:join', ({ conversationId }) => {
    socket.join(`convo:${conversationId}`);
  });

  socket.on('chat:leave', ({ conversationId }) => {
    socket.leave(`convo:${conversationId}`);
  });

  socket.on('chat:send', async ({ conversationId, text, attachment, productRef }, ack) => {
    try {
      const convo = await Conversation.findById(conversationId);
      if (!convo) return ack?.({ error: 'no convo' });
      if (!convo.participants.some((p) => String(p) === socket.userId)) return ack?.({ error: 'forbidden' });

      const toUser = convo.participants.find((p) => String(p) !== socket.userId);

      // Best-effort moderation — persist the message even if the service fails, but mark
      // it UNKNOWN+flagged so the recipient sees a warning. Flagged messages are still
      // delivered; we emit an additional `chat:flagged` event to the recipient.
      let moderation = { flagged: false, label: 'NEUTRAL', score: 0 };
      let faqSuggestion = null;
      if (text) {
        try {
          const { moderateText, suggestFaqReply } = require('../services/moderationService');
          moderation = await moderateText(text);
          try {
            faqSuggestion = await suggestFaqReply({ fromUser: socket.userId, toUser, text });
          } catch (_) { /* non-fatal */ }
        } catch (err) {
          moderation = { flagged: true, label: 'UNKNOWN', score: 0 };
          // eslint-disable-next-line no-console
          console.error('[chat-socket] moderation failed:', err.message);
        }
      }

      const msg = await Message.create({
        conversation: convo._id,
        from: socket.userId,
        to: toUser,
        text: text || '',
        attachment,
        productRef,
        moderation,
        faqSuggestion,
      });

      convo.lastMessage = { text: text || '[attachment]', at: msg.createdAt, from: socket.userId };
      const toKey = String(toUser);
      convo.unread.set(toKey, (convo.unread.get(toKey) || 0) + 1);
      await convo.save();

      io.to(`convo:${conversationId}`).emit('chat:message', msg);
      io.to(`user:${toUser}`).emit('chat:notify', {
        conversationId,
        from: socket.userId,
        preview: (text || '[attachment]').slice(0, 140),
      });
      if (moderation.flagged) {
        io.to(`user:${toUser}`).emit('chat:flagged', {
          messageId: msg._id,
          conversationId,
          from: socket.userId,
          label: moderation.label || 'UNKNOWN',
        });
      }

      ack?.({ ok: true, message: msg, moderation });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('chat:read', async ({ conversationId }) => {
    const convo = await Conversation.findById(conversationId);
    if (!convo) return;
    convo.unread.set(socket.userId, 0);
    await convo.save();
    socket.to(`convo:${conversationId}`).emit('chat:read', { by: socket.userId });
  });
};
