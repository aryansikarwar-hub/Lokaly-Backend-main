const CoHost = require('../models/CoHost');
const CoHostBooking = require('../models/CoHostBooking');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// GET /api/cohosts - List all co-hosts with filters
exports.getAllCoHosts = asyncHandler(async (req, res) => {
  const { category, city, language, available, sort, page = 1, limit = 20 } = req.query;
  
  const filter = { isActive: true };
  
  if (category && category !== 'All') filter.category = category;
  if (city) filter['location.city'] = city;
  if (language) filter.languages = language;
  if (available === 'true') filter.isAvailable = true;
  
  // Sort options
  let sortBy = { createdAt: -1 };
  if (sort === 'rating') sortBy = { rating: -1 };
  if (sort === 'price_low') sortBy = { perStreamRate: 1 };
  if (sort === 'price_high') sortBy = { perStreamRate: -1 };
  if (sort === 'experience') sortBy = { streamsHosted: -1 };
  
  const skip = (page - 1) * limit;
  
  const [coHosts, total] = await Promise.all([
    CoHost.find(filter)
      .populate('user', 'username avatar')
      .sort(sortBy)
      .skip(skip)
      .limit(parseInt(limit)),
    CoHost.countDocuments(filter),
  ]);
  
  res.json({
    success: true,
    count: coHosts.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: coHosts,
  });
});

// GET /api/cohosts/:id - Single co-host details
exports.getCoHostById = asyncHandler(async (req, res) => {
  const coHost = await CoHost.findById(req.params.id)
    .populate('user', 'username avatar email');
  
  if (!coHost) throw new ApiError(404, 'Co-host not found');
  
  res.json({ success: true, data: coHost });
});

// POST /api/cohosts - Apply to become a co-host
exports.applyAsCoHost = asyncHandler(async (req, res) => {
  const existing = await CoHost.findOne({ user: req.user._id });
  if (existing) throw new ApiError(400, 'You are already registered as a co-host');
  
  const {
    name, bio, location, category, specialty,
    languages, perStreamRate, profileImage,
  } = req.body;
  
  const coHost = await CoHost.create({
    user: req.user._id,
    name, bio, location, category, specialty,
    languages, perStreamRate, profileImage,
  });
  
  res.status(201).json({ success: true, data: coHost });
});

// PUT /api/cohosts/:id - Update co-host profile
exports.updateCoHost = asyncHandler(async (req, res) => {
  const coHost = await CoHost.findById(req.params.id);
  if (!coHost) throw new ApiError(404, 'Co-host not found');
  
  // Only owner can update
  if (coHost.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Not authorized');
  }
  
  Object.assign(coHost, req.body);
  await coHost.save();
  
  res.json({ success: true, data: coHost });
});

// PATCH /api/cohosts/:id/availability - Toggle availability
exports.toggleAvailability = asyncHandler(async (req, res) => {
  const coHost = await CoHost.findById(req.params.id);
  if (!coHost) throw new ApiError(404, 'Co-host not found');
  
  if (coHost.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Not authorized');
  }
  
  coHost.isAvailable = !coHost.isAvailable;
  await coHost.save();
  
  res.json({ success: true, data: coHost });
});

// POST /api/cohosts/:id/book - Book a co-host
exports.bookCoHost = asyncHandler(async (req, res) => {
  const { scheduledAt, duration, notes } = req.body;
  
  const coHost = await CoHost.findById(req.params.id);
  if (!coHost) throw new ApiError(404, 'Co-host not found');
  if (!coHost.isAvailable) throw new ApiError(400, 'Co-host is not available');
  
  // Calculate amount (per hour basis)
  const amount = coHost.perStreamRate * (duration / 60);
  
  // Check for time conflicts
  const conflict = await CoHostBooking.findOne({
    coHost: coHost._id,
    scheduledAt: new Date(scheduledAt),
    status: { $in: ['pending', 'confirmed', 'in-progress'] },
  });
  
  if (conflict) throw new ApiError(400, 'Co-host already booked for this time');
  
  const booking = await CoHostBooking.create({
    coHost: coHost._id,
    bookedBy: req.user._id,
    scheduledAt,
    duration: duration || 60,
    amount,
    notes,
  });
  
  // TODO: Create Razorpay order here using your existing razorpay config
  
  res.status(201).json({ success: true, data: booking });
});

// GET /api/cohosts/:id/bookings - Get co-host's bookings (owner only)
exports.getCoHostBookings = asyncHandler(async (req, res) => {
  const coHost = await CoHost.findById(req.params.id);
  if (!coHost) throw new ApiError(404, 'Co-host not found');
  
  if (coHost.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Not authorized');
  }
  
  const bookings = await CoHostBooking.find({ coHost: coHost._id })
    .populate('bookedBy', 'username avatar')
    .sort({ scheduledAt: -1 });
  
  res.json({ success: true, count: bookings.length, data: bookings });
});

// GET /api/cohosts/categories/stats - Filter counts
exports.getCategoryStats = asyncHandler(async (req, res) => {
  const stats = await CoHost.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  
  const total = await CoHost.countDocuments({ isActive: true });
  
  res.json({ success: true, total, categories: stats });
});

// DELETE /api/cohosts/:id - Deactivate co-host
exports.deleteCoHost = asyncHandler(async (req, res) => {
  const coHost = await CoHost.findById(req.params.id);
  if (!coHost) throw new ApiError(404, 'Co-host not found');
  
  if (coHost.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ApiError(403, 'Not authorized');
  }
  
  coHost.isActive = false;
  await coHost.save();
  
  res.json({ success: true, message: 'Co-host deactivated' });
});