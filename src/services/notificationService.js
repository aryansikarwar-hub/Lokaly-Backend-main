const Notification = require("../models/Notification");
const logger = require("../utils/logger");

async function createAndEmitNotification({
  userId,
  type,
  message,
  sender = null,
  conversationId = null,
  orderId = null,
  postId = null,
  liveSessionId = null,
  dedupeKey = null,
  meta = {},
}) {
  if (!userId) {
    throw new Error("userId is required to create notification");
  }

  let notification;
  try {
    notification = await Notification.create({
      userId,
      type,
      message,
      sender,
      conversationId,
      orderId,
      postId,
      liveSessionId,
      dedupeKey,
      meta,
    });
  } catch (err) {
    if (err?.code === 11000 && dedupeKey) {
      return Notification.findOne({ userId, dedupeKey }).lean();
    }
    throw err;
  }

  try {
    const { getIO } = require("../sockets");
    const io = getIO();
    io.to(`user:${String(userId)}`).emit("new_notification", notification);
  } catch (err) {
    logger.warn("createAndEmitNotification socket emit failed", {
      userId: String(userId),
      type,
      error: err.message,
    });
  }

  return notification;
}

module.exports = { createAndEmitNotification };
