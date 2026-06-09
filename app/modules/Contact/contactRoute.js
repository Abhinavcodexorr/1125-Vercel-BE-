const express = require('express');
const router = express.Router();
const contactController = require('./contactController');
const { isSuper } = require('../../middleware/authJWT');

// Public route - anyone can submit message
router.post('/', contactController.createContact);

// Admin routes - require authentication
router.get('/', isSuper, contactController.getAllMessages);

module.exports = router;
