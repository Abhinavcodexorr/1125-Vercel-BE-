const mongoose = require('mongoose');
const { normalizeCurrencyCode } = require('../../helper/currencyHelper');

const amenitySchema = new mongoose.Schema({
    key: { type: String, trim: true, default: '' },
    name: { type: String, required: true, trim: true },
    icon: { type: String, required: true, trim: true },
    iconType: { type: String, trim: true, default: 'material' }
}, { _id: false });

const roomImageSchema = new mongoose.Schema({
    url: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 }
}, { _id: false });

const blockedDateSchema = new mongoose.Schema({
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, trim: true, default: '' }
}, { timestamps: true });

const roomSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    type: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, default: 'GHS', uppercase: true },
    guests: { type: Number, required: true, min: 1 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    size: { type: Number, required: true, min: 0 },
    unit: { type: String, trim: true, default: 'sq ft' },
    amenities: { type: [amenitySchema], default: [] },
    images: { type: [roomImageSchema], default: [] },
    blockedDates: { type: [blockedDateSchema], default: [] },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

roomSchema.index({ isDeleted: 1, isActive: 1, createdAt: -1 });
roomSchema.index(
    { slug: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
);

const sortImages = (images) =>
    Array.isArray(images) ? [...images].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];

const baseShape = (doc) => ({
    _id: doc._id,
    title: doc.title,
    slug: doc.slug,
    type: doc.type,
    description: doc.description,
    price: doc.price,
    currency: normalizeCurrencyCode(doc.currency),
    guests: doc.guests,
    quantity: doc.quantity != null ? doc.quantity : 1,
    size: doc.size,
    unit: doc.unit || 'sq ft',
    amenities: doc.amenities || [],
    images: sortImages(doc.images),
    blockedDates: Array.isArray(doc.blockedDates)
        ? doc.blockedDates.map((block) => ({
              _id: block._id,
              startDate: block.startDate,
              endDate: block.endDate,
              reason: block.reason || '',
              createdAt: block.createdAt,
              updatedAt: block.updatedAt
          }))
        : [],
    isActive: doc.isActive,
    isDeleted: doc.isDeleted,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
});

roomSchema.methods.toApiShape = function toApiShape() {
    return baseShape(this.toObject ? this.toObject() : { ...this });
};

roomSchema.statics.toApiShapeFromLean = function toApiShapeFromLean(doc) {
    if (!doc) return null;
    return baseShape(doc);
};

roomSchema.statics.toWebsiteShapeFromLean = function toWebsiteShapeFromLean(doc) {
    const base = roomSchema.statics.toApiShapeFromLean(doc);
    if (!base) return null;
    delete base.isDeleted;
    delete base.blockedDates;
    return base;
};

module.exports = mongoose.model('Room', roomSchema);
