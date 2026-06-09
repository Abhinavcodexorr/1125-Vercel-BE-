const express = require('express');
const router = express.Router();
const superAdminController = require('./superAdminController');
const { isSuper, isSuperSub } = require('../../middleware/authJWT');

const denySubAdminForWrite = (req, res, next) => {
    if (req.role === 'SubAdmin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied! Only SuperAdmin/Manager can perform this action.'
        });
    }
    next();
};

// Public routes
router.post('/login', superAdminController.login);
router.post('/forgot-password', superAdminController.forgotPassword);

// Protected routes (require authentication)
router.post('/logout', isSuper, superAdminController.logout);
router.put('/password', isSuperSub, superAdminController.updatePassword);
router.get('/me', isSuperSub, superAdminController.getCurrentUser);
router.post('/subadmin', isSuper, superAdminController.createSubAdmin);
router.get('/subadmin', isSuperSub, superAdminController.getSubAdmins);
router.get('/subadmin/:id', isSuperSub, superAdminController.getSubAdminById);
router.put('/subadmin/:id', isSuperSub, denySubAdminForWrite, superAdminController.updateSubAdmin);
router.put('/subadmin/:id/block', isSuperSub, denySubAdminForWrite, superAdminController.blockSubAdmin);
router.put('/subadmin/:id/unblock', isSuperSub, denySubAdminForWrite, (req, res) => {
    req.body.isBlocked = false;
    return superAdminController.blockSubAdmin(req, res);
});
router.delete('/subadmin/:id', isSuperSub, denySubAdminForWrite, superAdminController.deleteSubAdmin);

module.exports = router;
