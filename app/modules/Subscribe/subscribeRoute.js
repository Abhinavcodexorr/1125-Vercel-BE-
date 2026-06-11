const express = require('express');
const router = express.Router();
const subscribeController = require('./subscribeController');
const { isSuperSub } = require('../../middleware/authJWT');

// Public — newsletter / subscribe section
router.post('/', subscribeController.subscribe);

// Admin — list subscribers
router.get('/admin', isSuperSub, subscribeController.listSubscribersAdmin);

module.exports = router;
