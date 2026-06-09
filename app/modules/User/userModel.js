const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    // Personal Information
    firstName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    lastName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    
    // Contact Information
    mobileNumber: {
        type: String,
        required: true,
        trim: true,
        match: [/^[0-9]{10,15}$/, 'Please enter a valid mobile number']
    },
    countryCode: {
        type: String,
        required: true,
        trim: true,
        default: "+1",
        match: [/^\+[1-9]\d{1,3}$/, 'Please enter a valid country code']
    },
    
    // Address Information
    address1: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    address2: {
        type: String,
        trim: true,
        maxlength: 200
    },
    townOrCity: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    state: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    country: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    pincode: {
        type: String,
        required: true,
        trim: true,
        match: [/^[0-9]{5,10}$/, 'Please enter a valid pincode']
    },
    
    // Special Requests
    specialRequests: {
        type: String,
        trim: true,
        maxlength: 1000
    },
    
    // Booking Information
    bookingId: {
        type: String,
        unique: true,
        sparse: true, // Allows null values but ensures uniqueness when present
        trim: true
    },
    
    // System Fields
    isActive: {
        type: Boolean,
        default: true
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    lastLogin: {
        type: Date,
        default: null
    },
    registrationDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ mobileNumber: 1 });
userSchema.index({ bookingId: 1 });
userSchema.index({ isActive: 1, isDeleted: 1 });
userSchema.index({ firstName: 1, lastName: 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

// Virtual for full phone number
userSchema.virtual('fullPhoneNumber').get(function() {
    return `${this.countryCode}${this.mobileNumber}`;
});

// Virtual for full address
userSchema.virtual('fullAddress').get(function() {
    let address = this.address1;
    if (this.address2) {
        address += `, ${this.address2}`;
    }
    address += `, ${this.townOrCity}, ${this.state}, ${this.country} - ${this.pincode}`;
    return address;
});

// Pre-save middleware to generate booking ID
userSchema.pre('save', function(next) {
    if (!this.bookingId && this.isNew) {
        // Generate booking ID: BK + timestamp + random 4 digits
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        this.bookingId = `BK${timestamp}${random}`;
    }
    next();
});

// Instance methods
userSchema.methods.getFormattedUser = function() {
    return {
        id: this._id,
        firstName: this.firstName,
        lastName: this.lastName,
        fullName: this.fullName,
        email: this.email,
        mobileNumber: this.mobileNumber,
        fullPhoneNumber: this.fullPhoneNumber,
        address1: this.address1,
        address2: this.address2,
        townOrCity: this.townOrCity,
        state: this.state,
        country: this.country,
        pincode: this.pincode,
        fullAddress: this.fullAddress,
        specialRequests: this.specialRequests,
        bookingId: this.bookingId,
        isActive: this.isActive,
        lastLogin: this.lastLogin,
        registrationDate: this.registrationDate,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
    };
};

const User = mongoose.model("User", userSchema);

module.exports = User;