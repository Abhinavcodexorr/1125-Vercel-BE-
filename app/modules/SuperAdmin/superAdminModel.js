const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const superAdminSchema = new mongoose.Schema({
    firstName: {
        type: String,
        trim: true
    },
    lastName: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    role: {
        type: String,
        enum: ['SuperAdmin', 'SubAdmin', 'Manager'],
        default: 'SuperAdmin'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    lastLogin: {
        type: Date,
        default: null
    },
    loginAttempts: {
        type: Number,
        default: 0
    },
    lockUntil: {
        type: Date
    },
    activeToken: {
        type: String,
        default: null
    },
    resetToken: {
        type: String,
        default: null
    },
    resetTokenExpiry: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Index for email
superAdminSchema.index({ email: 1 });

// Hash password before saving
superAdminSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Compare password method
superAdminSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
superAdminSchema.virtual('isLocked').get(function() {
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Increment login attempts
superAdminSchema.methods.incLoginAttempts = function() {
    // If we have a previous lock that has expired, restart at 1
    if (this.lockUntil && this.lockUntil < Date.now()) {
        return this.updateOne({
            $unset: { lockUntil: 1 },
            $set: { loginAttempts: 1 }
        });
    }
    
    const updates = { $inc: { loginAttempts: 1 } };
    
    // Lock account after 5 failed attempts for 2 hours
    if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
        updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
    }
    
    return this.updateOne(updates);
};

// Reset login attempts on successful login
superAdminSchema.methods.resetLoginAttempts = function() {
    return this.updateOne({
        $unset: { loginAttempts: 1, lockUntil: 1 },
        $set: { lastLogin: new Date() }
    });
};

/** Safe staff payload for list/detail APIs (never exposes password/token). */
superAdminSchema.methods.getFormattedStaff = function() {
    return formatStaffDocument(this);
};

const formatStaffDocument = (doc = {}) => {
    const firstName = doc.firstName || '';
    const lastName = doc.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || doc.email || '';
    const lastLogin = doc.lastLogin || null;

    return {
        id: doc._id,
        _id: doc._id,
        firstName,
        lastName,
        fullName,
        email: doc.email,
        role: doc.role,
        isActive: Boolean(doc.isActive),
        isBlocked: Boolean(doc.isBlocked),
        lastLogin,
        hasLoggedIn: Boolean(lastLogin),
        hasActiveSession: Boolean(doc.activeToken),
        createdAt: doc.createdAt || null,
        updatedAt: doc.updatedAt || null
    };
};

module.exports = mongoose.model('SuperAdmin', superAdminSchema);
module.exports.formatStaffDocument = formatStaffDocument;
