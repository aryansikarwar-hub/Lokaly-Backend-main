const express = require("express");
const router = express.Router();
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  clearNotifications,
} = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/auth");

router.use(requireAuth);
router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/read", markAsRead);
router.patch("/:id/read", markAsRead);
router.delete("/", clearNotifications);

module.exports = router;