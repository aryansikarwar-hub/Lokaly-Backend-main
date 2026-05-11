const Notification = require("../models/Notification");
const logger = require("../utils/logger");
const { createAndEmitNotification } = require("../services/notificationService");

const PAGE_SIZE = 20; // default page size, tune as needed

// ---------------------------------------------------------------------------
// GET /notifications?page=1&limit=20&unreadOnly=false
// ---------------------------------------------------------------------------
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id; // set by your auth middleware
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorised" });
    }

    // ── Query params ─────────────────────────────────────────────────────
    const page       = Math.max(1, parseInt(req.query.page)  || 1);
    const limit      = Math.min(100, parseInt(req.query.limit) || PAGE_SIZE);
    const unreadOnly = req.query.unreadOnly === "true";
    const type = req.query.type ? String(req.query.type).trim() : "";
    const skip       = (page - 1) * limit;

    // ── Filter ────────────────────────────────────────────────────────────
    const filter = { userId };
    if (unreadOnly) filter.isRead = false;
    if (type) filter.type = type;

    // ── Query (count + page run in parallel) ──────────────────────────────
    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sender", "name avatar") // only expose safe fields
        .lean(),
      Notification.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    });
  } catch (err) {
    logger.error("getNotifications failed", { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// PATCH /notifications/read          – mark all as read
// PATCH /notifications/:id/read      – mark one as read
// ---------------------------------------------------------------------------
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorised" });
    }

    const { id } = req.params; // undefined for the "mark all" route

    if (id) {
      // Single notification – verify ownership before updating
      const notification = await Notification.findOneAndUpdate(
        { _id: id, userId },
        { isRead: true },
        { new: true }
      );
      if (!notification) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      return res.json({ success: true, data: notification });
    }

    // Bulk update – only touches the authenticated user's documents
    const { modifiedCount } = await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );
    res.json({ success: true, markedRead: modifiedCount });
  } catch (err) {
    logger.error("markAsRead failed", { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// GET /notifications/unread-count
// ---------------------------------------------------------------------------
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorised" });
    }

    const count = await Notification.countDocuments({ userId, isRead: false });
    res.json({ success: true, count });
  } catch (err) {
    logger.error("getUnreadCount failed", { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

// ---------------------------------------------------------------------------
// DELETE /notifications
// ---------------------------------------------------------------------------
exports.clearNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorised" });
    }

    await Notification.deleteMany({ userId });
    res.json({ success: true, deleted: true });
  } catch (err) {
    logger.error("clearNotifications failed", { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.createAndEmitNotification = createAndEmitNotification;