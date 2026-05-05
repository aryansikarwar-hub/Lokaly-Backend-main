const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/coHostController');

// Public routes
router.get('/', ctrl.getAllCoHosts);
router.get('/categories/stats', ctrl.getCategoryStats);
router.get('/:id', ctrl.getCoHostById);

// Protected routes
router.post('/', protect, ctrl.applyAsCoHost);
router.put('/:id', protect, ctrl.updateCoHost);
router.patch('/:id/availability', protect, ctrl.toggleAvailability);
router.delete('/:id', protect, ctrl.deleteCoHost);

// Booking routes
router.post('/:id/book', protect, ctrl.bookCoHost);
router.get('/:id/bookings', protect, ctrl.getCoHostBookings);

module.exports = router;