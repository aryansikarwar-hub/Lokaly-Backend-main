const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const { runLeaderboard } = require('../services/leaderboardService');

// GET /api/leaderboard?limit=50&city=<opt>&role=seller|buyer
// Auth optional — if a Bearer token is present the caller's own rank is appended.
router.get('/', asyncHandler(async (req, res) => {
  const payload = await runLeaderboard(req);
  res.json(payload);
}));

module.exports = router;
