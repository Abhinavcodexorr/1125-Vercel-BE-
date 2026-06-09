const express = require('express');
const router = express.Router();
const roomController = require('./roomController');
const { isSuperSub } = require('../../middleware/authJWT');
const msg = require('./roomMessages');

const denySubAdminMutation = (req, res, next) => {
    if (req.role === 'SubAdmin') {
        return res.status(403).json({
            success: false,
            message: msg.SUBADMIN_MUTATION_DENIED
        });
    }
    next();
};

router.get('/admin', isSuperSub, roomController.getAllRoomsAdmin);
router.get('/admin/:id', isSuperSub, roomController.getRoomByIdAdmin);
router.post('/', isSuperSub, denySubAdminMutation, roomController.createRoom);
router.put('/:id', isSuperSub, denySubAdminMutation, roomController.updateRoom);
router.put('/:id/status', isSuperSub, denySubAdminMutation, roomController.setRoomStatus);
router.delete('/:id', isSuperSub, denySubAdminMutation, roomController.deleteRoom);

router.get('/', roomController.getRoomsForWebsite);
router.get('/:id/check-availability', roomController.checkRoomStayAvailability);
router.get('/:id/blocked-dates', isSuperSub, roomController.getRoomBlockedDates);
router.post('/:id/blocked-dates', isSuperSub, denySubAdminMutation, roomController.blockRoomDates);
router.delete('/:id/blocked-dates/:blockId', isSuperSub, denySubAdminMutation, roomController.unblockRoomDates);
router.get('/:id/availability', roomController.getRoomAvailability);
router.get('/:id', roomController.getRoomByIdForWebsite);

module.exports = router;
