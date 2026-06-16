const express = require('express');
const router = express.Router();
const bookingController = require('./bookingController');
const roomBookingController = require('./roomBookingController');
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

router.post('/create', roomBookingController.createRoomBooking);
router.post('/hubtel/callback', roomBookingController.handleHubtelCallback);
router.get('/confirm', roomBookingController.confirmHubtelBooking);
router.get('/reference/:reference', roomBookingController.getBookingByReference);

router.get('/dashboard', isSuperSub, bookingController.getDashboard);
router.get('/calendar', isSuperSub, bookingController.getCalendarBookings);
router.get('/', isSuperSub, bookingController.getAllBookings);
router.get('/statistics', isSuperSub, bookingController.getBookingStatistics);
router.get('/:id/payment-status', isSuperSub, bookingController.checkPaymentStatus);
router.get('/:id', isSuperSub, bookingController.getBookingById);
router.put('/:id/status', isSuperSub, denySubAdminForWrite, bookingController.updateBookingStatus);
router.put('/:id/manual-confirm', isSuperSub, denySubAdminForWrite, bookingController.manualConfirmBooking);
router.put('/:id/cancel', isSuperSub, denySubAdminForWrite, bookingController.cancelBooking);

module.exports = router;
