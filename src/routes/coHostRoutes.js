const router = require('express').Router();
const ctrl = require('../controllers/coHostController');
const { requireAuth } = require('../middleware/auth');

// ⚠️ Order matters: specific routes BEFORE :id routes

// Public
router.get('/', ctrl.getAllCoHosts);
router.get('/categories/stats', ctrl.getCategoryStats);

// Current user's stuff (must come BEFORE /:id)
router.get('/me', requireAuth, ctrl.getMyCoHostProfile);
router.get('/bookings/me', requireAuth, ctrl.getMyBookings);
router.patch('/bookings/:bookingId/cancel', requireAuth, ctrl.cancelBooking);

// CoHost CRUD
router.post('/', requireAuth, ctrl.applyAsCoHost);
router.get('/:id', ctrl.getCoHostById);
router.put('/:id', requireAuth, ctrl.updateCoHost);
router.delete('/:id', requireAuth, ctrl.deleteCoHost);
router.patch('/:id/availability', requireAuth, ctrl.toggleAvailability);

// Booking
router.post('/:id/book', requireAuth, ctrl.bookCoHost);
router.get('/:id/slots', ctrl.getBookedSlots);              // public (date-based)
router.get('/:id/bookings', requireAuth, ctrl.getCoHostBookings);

module.exports = router;