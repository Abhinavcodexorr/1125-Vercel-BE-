const PromoCode = require('./promoModel');
const response = require('../../helper/response');

const createPromoCode = async (req, res) => {
    try {
        const {
            code,
            description,
            discountType,
            discountValue,
            minOrderAmount,
            maxDiscountAmount,
            currency,
            usageType,
            maxUses,
            startDate,
            expiryDate,
            isActive
        } = req.body;

        if (!code || !discountType || discountValue == null) {
            return response.error400(res, 'code, discountType, and discountValue are required');
        }
        if (!['percentage', 'flat'].includes(discountType)) {
            return response.error400(res, 'discountType must be percentage or flat');
        }
        if (discountValue < 0) {
            return response.error400(res, 'discountValue must be >= 0');
        }

        const existing = await PromoCode.findOne({ code: code.trim().toUpperCase() });
        if (existing) {
            return response.error400(res, 'Promo code already exists');
        }

        const promo = new PromoCode({
            code: code.trim().toUpperCase(),
            description: description || '',
            discountType,
            discountValue: parseFloat(discountValue),
            minOrderAmount: minOrderAmount || 0,
            maxDiscountAmount: maxDiscountAmount || null,
            currency: currency || 'GHS',
            usageType: usageType || 'multiple',
            maxUses: maxUses || null,
            startDate: startDate || null,
            expiryDate: expiryDate || null,
            isActive: isActive !== false
        });
        await promo.save();

        return response.created201(res, 'Promo code created successfully', promo);
    } catch (error) {
        console.error('Create promo error:', error.message);
        return response.serverError500(res, 'Failed to create promo code', error.message);
    }
};

const getAllPromoCodesAdmin = async (req, res) => {
    try {
        const { isActive, page = 1, limit = 20 } = req.query;
        const filter = {};
        if (isActive !== undefined) {
            filter.isActive = isActive === 'true';
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [promos, total] = await Promise.all([
            PromoCode.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
            PromoCode.countDocuments(filter)
        ]);

        return response.success200(res, 'Promo codes retrieved successfully', {
            data: promos,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get all promos error:', error.message);
        return response.serverError500(res, 'Failed to retrieve promo codes', error.message);
    }
};

const getPromoCodeById = async (req, res) => {
    try {
        const promo = await PromoCode.findById(req.params.id);
        if (!promo) {
            return response.notFound404(res, 'Promo code not found');
        }
        return response.success200(res, 'Promo code retrieved successfully', promo);
    } catch (error) {
        console.error('Get promo by id error:', error.message);
        return response.serverError500(res, 'Failed to retrieve promo code', error.message);
    }
};

const updatePromoCode = async (req, res) => {
    try {
        const promo = await PromoCode.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!promo) {
            return response.notFound404(res, 'Promo code not found');
        }
        return response.success200(res, 'Promo code updated successfully', promo);
    } catch (error) {
        console.error('Update promo error:', error.message);
        return response.serverError500(res, 'Failed to update promo code', error.message);
    }
};

const deletePromoCode = async (req, res) => {
    try {
        const promo = await PromoCode.findByIdAndDelete(req.params.id);
        if (!promo) {
            return response.notFound404(res, 'Promo code not found');
        }
        return response.success200(res, 'Promo code deleted successfully');
    } catch (error) {
        console.error('Delete promo error:', error.message);
        return response.serverError500(res, 'Failed to delete promo code', error.message);
    }
};

const activateDeactivatePromoCode = async (req, res) => {
    try {
        const { isActive } = req.body;
        if (isActive === undefined) {
            return response.error400(res, 'isActive (true/false) is required');
        }
        const promo = await PromoCode.findByIdAndUpdate(req.params.id, { isActive: !!isActive }, { new: true });
        if (!promo) {
            return response.notFound404(res, 'Promo code not found');
        }
        return response.success200(res, `Promo code ${promo.isActive ? 'activated' : 'deactivated'} successfully`, promo);
    } catch (error) {
        console.error('Activate/deactivate promo error:', error.message);
        return response.serverError500(res, 'Failed to update promo code status', error.message);
    }
};

module.exports = {
    createPromoCode,
    getAllPromoCodesAdmin,
    getPromoCodeById,
    updatePromoCode,
    deletePromoCode,
    activateDeactivatePromoCode
};
