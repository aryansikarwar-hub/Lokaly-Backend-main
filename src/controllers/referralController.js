const asyncHandler = require('../utils/asyncHandler');
const { dashboard } = require('../services/referralService');

exports.myDashboard = asyncHandler(async (req, res) => {
  const data = await dashboard(req.user._id);
  res.json({ ...data, referralCode: req.user.referralCode });
});
