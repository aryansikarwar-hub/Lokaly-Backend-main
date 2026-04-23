const LiveSession = require('../models/LiveSession');

module.exports = function liveHandlers(io, socket) {
  socket.on('live:join', async ({ roomId }) => {
    if (!roomId) return;
    socket.join(`live:${roomId}`);
    const count = io.sockets.adapter.rooms.get(`live:${roomId}`)?.size || 1;
    io.to(`live:${roomId}`).emit('live:viewerCount', { count });

    try {
      const s = await LiveSession.findOne({ roomId });
      if (s) {
        s.stats.totalViewers += 1;
        s.stats.peakViewers = Math.max(s.stats.peakViewers, count);
        await s.save();
      }
    } catch (_) { /* non-fatal */ }
  });

  socket.on('live:leave', ({ roomId }) => {
    if (!roomId) return;
    socket.leave(`live:${roomId}`);
    const count = io.sockets.adapter.rooms.get(`live:${roomId}`)?.size || 0;
    io.to(`live:${roomId}`).emit('live:viewerCount', { count });
  });

  socket.on('live:chat', async ({ roomId, text }) => {
    if (!socket.userId || !text) return;
    let moderation = { flagged: false };
    try {
      const { moderateText } = require('../services/moderationService');
      moderation = await moderateText(text);
    } catch (_) { /* optional */ }

    io.to(`live:${roomId}`).emit('live:chat', {
      from: socket.userId,
      text: moderation.flagged ? '⚠︎ message hidden by Controlled Chats' : text,
      flagged: !!moderation.flagged,
      at: new Date(),
    });

    try {
      await LiveSession.updateOne({ roomId }, { $inc: { 'stats.chatMessages': 1 } });
    } catch (_) { /* non-fatal */ }
  });

  socket.on('live:reaction', async ({ roomId, emoji }) => {
    io.to(`live:${roomId}`).emit('live:reaction', { emoji, from: socket.userId });
    try {
      await LiveSession.updateOne({ roomId }, { $inc: { 'stats.reactions': 1 } });
    } catch (_) { /* non-fatal */ }
  });

  socket.on('live:productPin', ({ roomId, productId }) => {
    io.to(`live:${roomId}`).emit('live:productPin', { productId });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (typeof room === 'string' && room.startsWith('live:')) {
        const count = Math.max(0, (io.sockets.adapter.rooms.get(room)?.size || 1) - 1);
        io.to(room).emit('live:viewerCount', { count });
      }
    }
  });
};
