const mongoose = require('mongoose');

const gallerySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      default: '',
    },
    caption: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      enum: ['image', 'video'],
      default: 'video',
      index: true,
    },
    url: {
      type: String,
      required: [true, 'Media or video URL link is required'],
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      default: '',
    },
    section: {
      type: String,
      enum: ['villa_tour', 'outdoor', 'deck_events', 'interior', 'pool_beach'],
      default: 'villa_tour',
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Virtual id field
gallerySchema.virtual('id').get(function () {
  return this._id.toHexString();
});

gallerySchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Gallery', gallerySchema);
