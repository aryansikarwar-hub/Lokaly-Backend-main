const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    // ── Core ──────────────────────────────────────────────────────────────
    type: {
      type: String,
      required: true,
      index: true,
    },
    message: {
      type: String,
      trim: true,
    },

    // ── Relations ─────────────────────────────────────────────────────────
    /** The user this notification belongs to. */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /** Who triggered the notification (another user, a system process, etc.) */
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /** Relevant conversation, present when type === "chat". */
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },

    /** Relevant order, present when type === "order". */
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    postId: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },
    liveSessionId: {
      type: Schema.Types.ObjectId,
      ref: "LiveSession",
      default: null,
    },
    dedupeKey: {
      type: String,
      default: null,
      index: true,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // ── State ─────────────────────────────────────────────────────────────
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// ── Compound index ──────────────────────────────────────────────────────────
// Powers the two most common queries:
//   • fetch all unread notifications for a user  (userId, isRead)
//   • fetch all notifications for a user sorted newest-first  (userId, createdAt)
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);

module.exports = mongoose.model("Notification", notificationSchema);