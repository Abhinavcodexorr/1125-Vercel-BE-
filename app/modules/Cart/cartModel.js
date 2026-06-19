const mongoose = require('mongoose');
const { normalizeCartCurrencyFields, normalizeCurrencyCode } = require('../../helper/currencyHelper');

const cartItemSchema = new mongoose.Schema(
    {
        roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
        roomSnapshot: {
            title: { type: String, trim: true },
            slug: { type: String, trim: true },
            type: { type: String, trim: true },
            price: { type: Number, min: 0 },
            currency: { type: String, trim: true, default: 'GHS', set: normalizeCurrencyCode },
            guests: { type: Number, min: 1 },
            quantity: { type: Number, min: 1 },
            images: {
                type: [
                    {
                        _id: { type: mongoose.Schema.Types.ObjectId },
                        url: { type: String, trim: true },
                        alt: { type: String, trim: true, default: '' },
                        order: { type: Number, default: 0 }
                    }
                ],
                default: []
            }
        },
        checkInDate: { type: Date, required: true },
        checkOutDate: { type: Date, required: true },
        adults: { type: Number, default: 1, min: 1 },
        children: { type: Number, default: 0, min: 0 },
        quantity: { type: Number, default: 1, min: 1 },
        nights: { type: Number, default: 0, min: 0 },
        pricePerNight: { type: Number, default: 0, min: 0 },
        subTotal: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'GHS', set: normalizeCurrencyCode },
        isAvailable: { type: Boolean, default: true }
    },
    { timestamps: true }
);

const cartSchema = new mongoose.Schema(
    {
        cartId: { type: String, required: true, unique: true, index: true },
        items: { type: [cartItemSchema], default: [] },
        subTotal: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'GHS', set: normalizeCurrencyCode },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

cartSchema.pre('save', function normalizeCartCurrency(next) {
    normalizeCartCurrencyFields(this);
    next();
});

cartSchema.post('find', function normalizeFoundCartCurrencies(docs) {
    if (Array.isArray(docs)) {
        docs.forEach(normalizeCartCurrencyFields);
    }
});

cartSchema.post('findOne', function normalizeFoundCartCurrency(doc) {
    normalizeCartCurrencyFields(doc);
});

module.exports = mongoose.model('Cart', cartSchema);
