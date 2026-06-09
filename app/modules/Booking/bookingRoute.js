const express = require('express');
const router = express.Router();
const bookingController = require('./bookingController');
const { isSuperSub } = require('../../middleware/authJWT');

const denySubAdminForWrite = (req, res, next) => {
    if (req.role === 'SubAdmin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied! SubAdmin can view bookings but cannot update booking actions.'
        });
    }
    next();
};

router.get('/dashboard', bookingController.getDashboard);
router.get('/calendar', bookingController.getCalendarBookings);
router.get('/', isSuperSub, bookingController.getAllBookings);
router.get('/statistics', bookingController.getBookingStatistics);
router.get('/:id/payment-status', bookingController.checkPaymentStatus);
router.get('/:id', bookingController.getBookingById);
router.put('/:id/status', isSuperSub, denySubAdminForWrite, bookingController.updateBookingStatus);
router.put('/:id/manual-confirm', isSuperSub, denySubAdminForWrite, bookingController.manualConfirmBooking);
router.put('/:id/cancel', isSuperSub, denySubAdminForWrite, bookingController.cancelBooking);

module.exports = router;
