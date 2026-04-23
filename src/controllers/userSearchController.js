const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/users/search?q=<text>&role=seller|buyer&limit=20 — auth required.
// Case-insensitive substring regex on name + shopName, excludes the caller.
exports.search = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const role = (req.query.role || '').trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  if (!q) return res.json([]);

  const rx = new RegExp(escapeRegex(q), 'i');
  const filter = {
    _id: { $ne: req.user._id },
    isActive: { $ne: false },
    $or: [{ name: rx }, { shopName: rx }],
  };
  if (['buyer', 'seller', 'admin'].includes(role)) filter.role = role;

  const users = await User.find(filter)
    .limit(limit)
    .select('name avatar role shopName isVerifiedSeller');

  res.json(users.map((u) => ({
    _id: u._id,
    name: u.name,
    avatar: u.avatar || '',
    role: u.role,
    shopName: u.shopName || null,
    isVerifiedSeller: !!u.isVerifiedSeller,
  })));
});
