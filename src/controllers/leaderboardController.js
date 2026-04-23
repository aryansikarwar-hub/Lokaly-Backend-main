// Leaderboard controller — thin wrapper around leaderboardService.
// Route: GET /api/leaderboard?limit=50&scope=global|city&city=...&type=sellers|buyers
// See src/services/leaderboardService.js for shape + scoring details.

const asyncHandler = require('../utils/asyncHandler');
const { runLeaderboard } = require('../services/leaderboardService');

exports.list = asyncHandler(async (req, res) => {
  const payload = await runLeaderboard(req);
  res.json(payload);
});
