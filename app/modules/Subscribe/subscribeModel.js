const mongoose = require('mongoose');

const subscribeSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
        },
        source: {
            type: String,
            trim: true,
            default: 'website'
        },
        isDeleted: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

subscribeSchema.index({ createdAt: -1 });

subscribeSchema.methods.getFormatted = function () {
    return {
        _id: this._id,
        email: this.email,
        source: this.source,
        subscribedAt: this.createdAt,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
    };
};

module.exports = mongoose.model('Subscribe', subscribeSchema);
