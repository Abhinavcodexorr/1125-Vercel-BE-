// bookingModel.js - Add these fields to your existing schema
const mongoose = require('mongoose');
const { getRefundPolicyAnchorDate } = require('../../helper/refundPolicyAnchor');

// Explicit subdocument for cabin packages (avoids Mongoose "type" reserved word ambiguity)
const cabinPackageSchema = new mongoose.Schema({
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package', required: true },
    name: { type: String, default: '' },
    type: { type: Number, enum: [0, 1], required: true },
    amount: { type: Number, required: true },
    /** true = flat add-on (not × nights); false/missing = amount × nights */
    per_night: { type: Boolean, default: false }
}, { _id: false });

const bookingSchema = new mongoose.Schema({
    // ... your existing fields ...
    
    cabinId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Cabin',
        required: false // Optional for cart-based bookings (cabins[] or activities[] only)
    },
    roomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Room',
        required: false,
        index: true
    },
    roomSnapshot: {
        title: { type: String, trim: true },
        slug: { type: String, trim: true },
        type: { type: String, trim: true },
        price: { type: Number, min: 0 },
        currency: { type: String, trim: true, default: 'GHS' },
        guests: { type: Number, min: 1 }
    },
    nights: {
        type: Number,
        required: false,
        min: 0
    },
    roomPricePerNight: {
        type: Number,
        required: false,
        min: 0
    },
    roomQuantity: {
        type: Number,
        default: 1,
        min: 1
    },
    // Cart-based: multiple cabins (from cart.items)
    cabins: [{
        cabinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabin', required: true },
        cabinName: { type: String, required: true },
        checkInDate: { type: Date, required: true },
        checkOutDate: { type: Date, required: true },
        nights: { type: Number, required: true },
        adults: { type: Number, default: 0 },
        children: { type: Number, default: 0 },
        cabinAmount: { type: Number, required: true },
        packages: { type: [cabinPackageSchema], default: [] },
        packageAmount: { type: Number, default: 0 },
        totalAmount: { type: Number, required: true },
        currency: { type: String, default: 'GHS' }
    }],
    // Cart-based: multiple activities (from cart.activityItems)
    activities: [{
        activityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', required: true },
        activityName: { type: String, required: true },
        checkInDate: { type: Date, required: true },
        checkOutDate: { type: Date, required: true },
        single: { type: Number, default: 0 },
        couple: { type: Number, default: 0 },
        groupOfFour: { type: Number, default: 0 },
        children: { type: Number, default: 0 },
        amount: { type: Number, required: true },
        currency: { type: String, default: 'GHS' }
    }],
    cartId: { type: String },
    subTotal: { type: Number },
    discount: { type: Number, default: 0 },
    promoCode: { type: String },
    promoCodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromoCode' },
    package: {
        type: [{
            packageId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Package',
                required: true
            },
            type: {
                type: Number,
                enum: [0, 1], // 0 = per person, 1 = per couple
                required: true
            },
            amount: {
                type: Number,
                required: true
            },
            currency: {
                type: String,
                required: true
            }
        }],
        required: false // Optional - package is not mandatory
        // NOTE: This is stored as a SNAPSHOT (embedded array), not a reference
        // If package pricing changes later, this booking's package array remains unchanged
        // This preserves historical pricing data for the booking
    },
    checkInDate: {
        type: Date,
        required: false // Optional for cart-based (activities-only)
    },
    checkOutDate: {
        type: Date,
        required: false
    },
    adults: {
        type: Number,
        required: false
    },
    children: {
        type: Number,
        default: 0
    },
    guestDetails: {
        type: {
            firstName: {
                type: String,
                required: true
            },
            lastName: {
                type: String,
                required: true
            },
            email: {
                type: String,
                required: true
            },
            mobileNumber: {
                type: String,
                required: true
            },
            countryCode: {
                type: String
            },
            address1: {
                type: String
            },
            address2: {
                type: String
            },
            townOrCity: {
                type: String
            },
            state: {
                type: String
            },
            country: {
                type: String
            },
            pincode: {
                type: String
            },
            specialRequests: {
                type: String
            }
        },
        required: true
    },
    cabinPricePerNight: {
        type: Number,
        required: false
    },
    totalAmount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'GHS'
    },
    
    // Payment-related fields
    paymentMethod: {
        type: String,
        enum: ['Credit Card', 'Mobile Money', 'Bank Transfer', 'Cash', 'Paystack', 'Hubtel'],
        default: 'Credit Card'
    },
    // Booking status field
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'Checked-In', 'Checked-Out', 'Cancelled', 'No-Show'],
        default: 'Pending'
    },
    paymentStatus: {
        type: String,
        enum: ['incomplete', 'pending', 'paid', 'failed', 'refunded'],
        default: 'incomplete'
    },
    transactionId: {
        type: String,
        sparse: true // Allows null values but creates unique index when present
    },
    paymentDate: {
        type: Date
    },
    paymentResponse: {
        type: Object // Store full ExpressPay response
    },
    paymentToken: {
        type: String
    },
    /** Same value may appear on multiple documents (multi-cabin cart). Index is non-unique — see bookingSchema.index below. */
    bookingReference: {
        type: String
    },
    // Cancellation fields
    cancellationReason: {
        type: String
    },
    cancellationFee: {
        type: Number,
        default: 0
    },
    cancelledAt: {
        type: Date
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    incompleteBookingEmailSent: {
        type: Boolean,
        default: false
    },
    /** Room booking payment hold — blocks overlapping dates until expiry or payment. */
    holdExpiresAt: {
        type: Date,
        default: null,
        index: true
    }
    
}, {
    timestamps: true
});

// Generate booking reference before saving
bookingSchema.pre('save', function(next) {
    if (!this.bookingReference) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const length = 8; // 6-8 allowed; using 8 for better uniqueness
        let ref = '';
        for (let i = 0; i < length; i += 1) {
            ref += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.bookingReference = ref; // alphanumeric only, no separators
    }
    next();
});

// Method to get formatted booking
bookingSchema.methods.getFormattedBooking = function() {
    const amountPaidRaw = Number(this.totalAmount) || 0;
    const discountRaw = Number(this.discount) || 0;
    const actualAmountRaw =
        Number.isFinite(Number(this.subTotal)) && Number(this.subTotal) > 0
            ? Number(this.subTotal)
            : amountPaidRaw + discountRaw;

    const formatted = {
        _id: this._id,
        bookingReference: this.bookingReference,
        cabinId: this.cabinId,
        roomId: this.roomId,
        roomSnapshot: this.roomSnapshot || null,
        nights: this.nights,
        roomPricePerNight: this.roomPricePerNight,
        roomQuantity: this.roomQuantity || 1,
        package: this.package || null, // Include package array if present
        activities: Array.isArray(this.activities)
            ? this.activities.map((a) => (a && typeof a.toObject === 'function' ? a.toObject() : a))
            : [],
        checkInDate: this.checkInDate,
        checkOutDate: this.checkOutDate,
        adults: this.adults,
        children: this.children,
        guestDetails: this.guestDetails,
        cabinPricePerNight: this.cabinPricePerNight,
        promoCode: this.promoCode || null,
        promoCodeId: this.promoCodeId || null,
        actualAmount: Number(actualAmountRaw.toFixed(2)),
        discountApplied: Number(discountRaw.toFixed(2)),
        amountPaid: Number(amountPaidRaw.toFixed(2)),
        totalAmount: this.totalAmount,
        currency: this.currency,
        paymentMethod: this.paymentMethod,
        status: this.status,
        paymentStatus: this.paymentStatus,
        transactionId: this.transactionId, // Included for all bookings including cancelled ones (may be null if cancelled before payment)
        paymentDate: this.paymentDate,
        cancelledAt: this.cancelledAt,
        holdExpiresAt: this.holdExpiresAt || null,
        cancellationReason: this.cancellationReason,
        cancellationFee: this.cancellationFee,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
    };

    // Derive payment type (Mobile Money, Credit Card, etc.) from paymentResponse
    let paymentType = null;
    const pr = this.paymentResponse || {};
    const prData = pr.Data || pr.data || {};
    const prAuth = prData.authorization || pr.authorization || {};

    if (this.paymentMethod === 'Hubtel') {
        const pd = prData.PaymentDetails || prData.paymentDetails || {};
        const pType = (pd.PaymentType || pd.paymentType || '').toLowerCase();
        const channel = (pd.Channel || pd.channel || '').toLowerCase();
        if (pType === 'mobilemoney' || channel.includes('mtn') || channel.includes('vodafone') || channel.includes('airtel')) {
            const channelMap = { 'mtn-gh': 'MTN', 'mtn': 'MTN', 'vodafone-gh': 'Vodafone', 'vodafone': 'Vodafone', 'airtel-gh': 'Airtel', 'airtel': 'Airtel' };
            const network = channelMap[channel] || channel.replace(/-gh$/, '').replace(/^./, c => c.toUpperCase()) || 'Mobile Money';
            paymentType = `Mobile Money (${network})`;
        } else if (pType === 'card' || channel.includes('card')) {
            paymentType = 'Credit/Debit Card';
        } else if (pType || channel) {
            paymentType = pType || channel;
        }
    } else if (this.paymentMethod === 'Paystack') {
        const channel = (prAuth.channel || '').toLowerCase();
        const cardType = prAuth.card_type || prAuth.cardType || '';
        if (channel === 'card') {
            paymentType = cardType ? `Credit/Debit Card (${cardType})` : 'Credit/Debit Card';
        } else if (channel === 'bank') {
            paymentType = 'Bank Transfer';
        } else if (channel === 'mobile_money' || channel === 'mobilemoney') {
            paymentType = 'Mobile Money';
        } else if (channel) {
            paymentType = channel;
        }
    } else if (this.paymentMethod === 'Credit Card' || this.paymentMethod === 'ExpressPay') {
        paymentType = 'Credit/Debit Card';
    } else if (this.paymentMethod) {
        paymentType = this.paymentMethod;
    }
    formatted.paymentType = paymentType || this.paymentMethod || null;

    if (this.status === 'Cancelled' && this.cancelledAt) {
        const anchor = getRefundPolicyAnchorDate(this) || this.checkInDate;
        let refundPercentage = 0;
        let refundEligibility = 'No refund (Cancellation on the same day)';
        if (anchor) {
            const policyDate = new Date(anchor);
            const cancelledDate = new Date(this.cancelledAt);
            policyDate.setHours(0, 0, 0, 0);
            cancelledDate.setHours(0, 0, 0, 0);
            const daysBefore = (policyDate - cancelledDate) / (1000 * 60 * 60 * 24);
            if (daysBefore >= 7) {
                refundPercentage = 100;
                refundEligibility = '100% refund (Cancellation 7+ days before date)';
            } else if (daysBefore >= 1) {
                refundPercentage = 50;
                refundEligibility = '50% refund (Cancellation within 1–6 days)';
            }
        }

        const refundAmount = amountPaidRaw * refundPercentage / 100;

        formatted.refundAmount = Number(refundAmount.toFixed(2));
        formatted.refundPercentage = refundPercentage;
        formatted.refundEligibility = refundEligibility;
    }
    

    return formatted;
};

// Non-unique: several booking rows can share one bookingReference (split cart).
bookingSchema.index({ bookingReference: 1 }, { unique: false });
bookingSchema.index({ roomId: 1, checkInDate: 1, checkOutDate: 1 });
bookingSchema.index({ roomId: 1, status: 1, paymentStatus: 1 });

module.exports = mongoose.model('Booking', bookingSchema);