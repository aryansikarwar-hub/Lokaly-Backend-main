const CoHost = require('../models/CoHost');
const CoHostBooking = require('../models/CoHostBooking');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// GET /api/cohosts - List all co-hosts with filters
exports.getAllCoHosts = asyncHandler(async (req, res) => {
  const { category, city, language, available, sort, page = 1, limit = 20, q } = req.query;

  const filter = { isActive: true };

  if (category && category !== 'All') filter.category = category;
  if (city) filter['location.city'] = city;
  if (language) filter.languages = language;
  if (available === 'true') filter.isAvailable = true;
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { specialty: { $regex: q, $options: 'i' } },
    ];
  }

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

// GET /api/cohosts/me - Current user's cohost profile (if any)
exports.getMyCoHostProfile = asyncHandler(async (req, res) => {
  const coHost = await CoHost.findOne({ user: req.user._id });
  res.json({ success: true, data: coHost }); // null if not a cohost yet
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

  // Basic validation
  if (!name || !category || !specialty || !location?.city || !perStreamRate) {
    throw new ApiError(400, 'name, category, specialty, location.city and perStreamRate are required');
  }

  const coHost = await CoHost.create({
    user: req.user._id,
    name,
    bio,
    location,
    category,
    specialty,
    languages: languages || [],
    perStreamRate,
    profileImage,
  });

  res.status(201).json({ success: true, data: coHost });
});

// PUT /api/cohosts/:id - Update co-host profile
exports.updateCoHost = asyncHandler(async (req, res) => {
  const coHost = await CoHost.findById(req.params.id);
  if (!coHost) throw new ApiError(404, 'Co-host not found');

  if (coHost.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Not authorized');
  }

  // Whitelist updatable fields (don't let users change rating/karma)
  const allowed = ['name', 'bio', 'location', 'category', 'specialty',
    'languages', 'perStreamRate', 'profileImage', 'isAvailable'];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) coHost[k] = req.body[k];
  });

  await coHost.save();
  res.json({ success: true, data: coHost });
});

// PATCH /api/cohosts/:id/availability
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

// POST /api/cohosts/:id/book - Book a co-host (with proper overlap detection)
exports.bookCoHost = asyncHandler(async (req, res) => {
  const { scheduledAt, duration = 60, notes } = req.body;

  if (!scheduledAt) throw new ApiError(400, 'scheduledAt is required');

  const startTime = new Date(scheduledAt);
  if (isNaN(startTime.getTime())) throw new ApiError(400, 'Invalid scheduledAt');
  if (startTime <= new Date()) throw new ApiError(400, 'Scheduled time must be in the future');

  const endTime = new Date(startTime.getTime() + duration * 60_000);

  const coHost = await CoHost.findById(req.params.id);
  if (!coHost) throw new ApiError(404, 'Co-host not found');
  if (!coHost.isActive) throw new ApiError(400, 'Co-host is not active');
  if (!coHost.isAvailable) throw new ApiError(400, 'Co-host is not available');

  // Don't let user book themselves
  if (coHost.user.toString() === req.user._id.toString()) {
    throw new ApiError(400, 'You cannot book your own co-host profile');
  }

  // ✅ PROPER OVERLAP DETECTION
  // Two bookings overlap if: existing.start < new.end AND existing.end > new.start
  const conflict = await CoHostBooking.findOne({
    coHost: coHost._id,
    status: { $in: ['pending', 'confirmed', 'in-progress'] },
    scheduledAt: { $lt: endTime },
    endsAt: { $gt: startTime },
  });

  if (conflict) {
    throw new ApiError(409, 'Co-host is already booked for an overlapping time slot');
  }

  // Pricing — per stream rate is treated as base for 60 min
  const amount = Math.round(coHost.perStreamRate * (duration / 60));

  const booking = await CoHostBooking.create({
    coHost: coHost._id,
    bookedBy: req.user._id,
    scheduledAt: startTime,
    duration,
    amount,
    notes,
  });

  // Bump cohost stats
  coHost.totalBookings += 1;
  await coHost.save();

  // TODO: Razorpay order creation here
  // const order = await razorpay.orders.create({ amount: amount * 100, currency: 'INR', receipt: booking._id.toString() });
  // booking.payment.orderId = order.id;
  // await booking.save();

  res.status(201).json({ success: true, data: booking });
});

// GET /api/cohosts/:id/slots?date=YYYY-MM-DD
// Returns booked time ranges for a given day so the UI can disable them
exports.getBookedSlots = asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!date) throw new ApiError(400, 'date query (YYYY-MM-DD) is required');

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd   = new Date(`${date}T23:59:59.999Z`);

  const bookings = await CoHostBooking.find({
    coHost: req.params.id,
    status: { $in: ['pending', 'confirmed', 'in-progress'] },
    scheduledAt: { $lt: dayEnd },
    endsAt: { $gt: dayStart },
  }).select('scheduledAt endsAt duration');

  res.json({
    success: true,
    data: bookings.map((b) => ({
      start: b.scheduledAt,
      end: b.endsAt,
      duration: b.duration,
    })),
  });
});

// GET /api/cohosts/:id/bookings - Owner only
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

// GET /api/cohosts/bookings/me - Bookings made BY the current user
exports.getMyBookings = asyncHandler(async (req, res) => {
  const bookings = await CoHostBooking.find({ bookedBy: req.user._id })
    .populate({
      path: 'coHost',
      select: 'name profileImage location specialty perStreamRate',
      populate: { path: 'user', select: 'username avatar' },
    })
    .sort({ scheduledAt: -1 });

  res.json({ success: true, count: bookings.length, data: bookings });
});

// PATCH /api/cohosts/bookings/:bookingId/cancel
exports.cancelBooking = asyncHandler(async (req, res) => {
  const booking = await CoHostBooking.findById(req.params.bookingId).populate('coHost');
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isBooker = booking.bookedBy.toString() === req.user._id.toString();
  const isCoHostOwner = booking.coHost.user.toString() === req.user._id.toString();

  if (!isBooker && !isCoHostOwner) throw new ApiError(403, 'Not authorized');
  if (['completed', 'cancelled'].includes(booking.status)) {
    throw new ApiError(400, `Booking already ${booking.status}`);
  }

  booking.status = 'cancelled';
  booking.cancelledBy = req.user._id;
  booking.cancelledAt = new Date();
  booking.cancelReason = req.body.reason || '';
  await booking.save();

  // Bump cohost stats
  await CoHost.findByIdAndUpdate(booking.coHost._id, { $inc: { cancelledBookings: 1 } });

  res.json({ success: true, data: booking });
});

// GET /api/cohosts/categories/stats
exports.getCategoryStats = asyncHandler(async (req, res) => {
  const stats = await CoHost.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);

  const total = await CoHost.countDocuments({ isActive: true });
  res.json({ success: true, total, categories: stats });
});

// DELETE /api/cohosts/:id
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