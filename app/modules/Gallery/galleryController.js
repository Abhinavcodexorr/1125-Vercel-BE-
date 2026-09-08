const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Gallery = require('./galleryModel');

// Configure Multer storage for direct video & image file uploads
const uploadDir = path.join(__dirname, '../../../uploads/gallery');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${safeName}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250MB limit for video files
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('image/') ||
      file.originalname.match(/\.(mp4|webm|mov|m4v|avi|mkv|jpg|jpeg|png|webp)$/i)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only video and image files are supported!'), false);
    }
  },
});

/**
 * @route   GET /api/v1/gallery
 * @desc    Get all gallery items / videos with optional filtering
 * @query   type (image|video), section, isActive
 */
router.get('/', async (req, res) => {
  try {
    const filter = { isDeleted: false };

    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.section && req.query.section !== 'all') {
      filter.section = req.query.section;
    }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const items = await Gallery.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: 'Gallery fetched successfully',
      data: items.map((item) => ({ ...item, id: item._id })),
      total: items.length,
    });
  } catch (error) {
    console.error('Error fetching gallery:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch gallery items',
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/v1/gallery/:id
 * @desc    Get single gallery item
 */
router.get('/:id', async (req, res) => {
  try {
    const item = await Gallery.findOne({ _id: req.params.id, isDeleted: false });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Gallery item not found' });
    }
    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   POST /api/v1/gallery
 * @desc    Add new video link or image to the dedicated Gallery table
 * @body    { title, caption, type, url, thumbnailUrl, section, sortOrder, isActive }
 */
router.post('/', async (req, res) => {
  try {
    const { title, caption, type = 'video', url, thumbnailUrl, section = 'villa_tour', sortOrder = 0, isActive = true } = req.body;

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A valid media or video URL link is required',
      });
    }

    const newItem = new Gallery({
      title: (title || '').trim(),
      caption: (caption || '').trim(),
      type: type === 'video' ? 'video' : 'image',
      url: url.trim(),
      thumbnailUrl: (thumbnailUrl || '').trim(),
      section: section || 'villa_tour',
      sortOrder: Number(sortOrder) || 0,
      isActive: isActive !== false,
      isDeleted: false,
    });

    const saved = await newItem.save();

    return res.status(201).json({
      success: true,
      message: 'Media successfully saved to gallery',
      data: saved,
    });
  } catch (error) {
    console.error('Error creating gallery item:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save gallery item',
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/v1/gallery/upload-video
 * @desc    Upload video or image file directly to server and return URL
 */
router.post('/upload-video', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file provided' });
    }

    // Determine public URL
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    const publicUrl = `${protocol}://${host}/uploads/gallery/${req.file.filename}`;

    return res.status(200).json({
      success: true,
      message: 'Video uploaded successfully',
      data: {
        url: publicUrl,
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error('Error uploading video:', error);
    return res.status(500).json({
      success: false,
      message: 'Video upload failed',
      error: error.message,
    });
  }
});

/**
 * @route   PUT /api/v1/gallery/:id
 * @desc    Update gallery item / video link
 */
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates._id;
    delete updates.id;

    const updated = await Gallery.findOneAndUpdate(
      { _id: req.params.id, isDeleted: false },
      { $set: updates },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Gallery item not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Gallery item updated successfully',
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update gallery item',
      error: error.message,
    });
  }
});

/**
 * @route   DELETE /api/v1/gallery/:id
 * @desc    Soft delete gallery item
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Gallery.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { isDeleted: true, isActive: false } },
      { new: true }
    );

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Gallery item not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Gallery item deleted successfully',
      data: deleted,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete gallery item',
      error: error.message,
    });
  }
});

module.exports = router;
