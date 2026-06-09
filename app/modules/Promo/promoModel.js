const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        unique: true,
        index: true
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    discountType: {
        type: String,
        required: true,
        enum: ['percentage', 'flat'],
        default: 'percentage'
    },
    discountValue: {
        type: Number,
        required: true,
        min: 0
    },
    minOrderAmount: {
        type: Number,
        default: 0
    },
    maxDiscountAmount: {
        type: Number,
        default: null
    },
    currency: {
        type: String,
        default: 'GHS'
    },
    usageType: {
        type: String,
        enum: ['one-time', 'multiple'],
        default: 'multiple'
    },
    usedCount: {
        type: Number,
        default: 0
    },
    maxUses: {
        type: Number,
        default: null
    },
    startDate: {
        type: Date,
        default: null
    },
    expiryDate: {
        type: Date,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

promoSchema.index({ code: 1, isActive: 1 });

/** Call once when a booking is confirmed paid and used this promo (increments global usage). */
promoSchema.statics.incrementUsedCountIfPresent = async function incrementUsedCountIfPresent(promoCodeId) {
    if (!promoCodeId) return;
    try {
        await this.updateOne({ _id: promoCodeId }, { $inc: { usedCount: 1 } });
    } catch (e) {
        console.error('[PromoCode] incrementUsedCountIfPresent failed:', e?.message);
    }
};

const PromoCode = mongoose.model('PromoCode', promoSchema);
module.exports = PromoCode;
