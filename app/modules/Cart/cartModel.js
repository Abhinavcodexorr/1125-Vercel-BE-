const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
    {
        roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
        roomSnapshot: {
            title: { type: String, trim: true },
            slug: { type: String, trim: true },
            type: { type: String, trim: true },
            price: { type: Number, min: 0 },
            currency: { type: String, trim: true, default: 'GHS' },
            guests: { type: Number, min: 1 },
            quantity: { type: Number, min: 1 }
        },
        checkInDate: { type: Date, required: true },
        checkOutDate: { type: Date, required: true },
        adults: { type: Number, default: 1, min: 1 },
        children: { type: Number, default: 0, min: 0 },
        quantity: { type: Number, default: 1, min: 1 },
        nights: { type: Number, default: 0, min: 0 },
        pricePerNight: { type: Number, default: 0, min: 0 },
        subTotal: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'GHS' },
        isAvailable: { type: Boolean, default: true },
        unavailableReason: { type: String, default: null }
    },
    { timestamps: true }
);

const cartSchema = new mongoose.Schema(
    {
        cartId: { type: String, required: true, unique: true, index: true },
        items: { type: [cartItemSchema], default: [] },
        subTotal: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: 'GHS' },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Cart', cartSchema);
