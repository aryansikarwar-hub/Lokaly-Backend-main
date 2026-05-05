const router = require('express').Router();
const ctrl = require('../controllers/coHostController');
const { requireAuth } = require('../middleware/auth');

// Public routes
router.get('/', ctrl.getAllCoHosts);
router.get('/categories/stats', ctrl.getCategoryStats);
router.get('/:id', ctrl.getCoHostById);

// Protected routes
router.post('/', requireAuth, ctrl.applyAsCoHost);
router.put('/:id', requireAuth, ctrl.updateCoHost);
router.patch('/:id/availability', requireAuth, ctrl.toggleAvailability);
router.delete('/:id', requireAuth, ctrl.deleteCoHost);

// Booking routes
router.post('/:id/book', requireAuth, ctrl.bookCoHost);
router.get('/:id/bookings', requireAuth, ctrl.getCoHostBookings);

module.exports = router;