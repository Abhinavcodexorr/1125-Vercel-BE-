const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
    message: {
        type: String,
        required: true,
        trim: true
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Method to get formatted contact
contactSchema.methods.getFormattedContact = function() {
    return {
        _id: this._id,
        message: this.message,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
    };
};

module.exports = mongoose.model('Contact', contactSchema);

