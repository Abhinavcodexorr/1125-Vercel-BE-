const express = require('express');
const router = express.Router();
const promoController = require('./promoController');
const { isSuperSub } = require('../../middleware/authJWT');

const denySubAdminMutation = (req, res, next) => {
    if (req.role === 'SubAdmin') {
        return res.status(403).json({
            success: false,
            message:
                'Access denied! SubAdmin can only view promo listings, not create, edit, delete, or activate/deactivate promo codes.'
        });
    }
    next();
};

router.post('/', isSuperSub, denySubAdminMutation, promoController.createPromoCode);
router.get('/admin', isSuperSub, promoController.getAllPromoCodesAdmin);
router.get('/', isSuperSub, promoController.getAllPromoCodesAdmin);
router.get('/:id', isSuperSub, promoController.getPromoCodeById);
router.put('/:id', isSuperSub, denySubAdminMutation, promoController.updatePromoCode);
router.delete('/:id', isSuperSub, denySubAdminMutation, promoController.deletePromoCode);
router.put('/:id/status', isSuperSub, denySubAdminMutation, promoController.activateDeactivatePromoCode);

module.exports = router;
