const express = require('express');
const router = express.Router();
const fileUpload = require('express-fileupload');
const Upload = require('./uploadController');
const { isSuperSub } = require('../../middleware/authJWT');

router.use(fileUpload());

router.post('/', isSuperSub, Upload.upload_file);
router.post('/room-image', isSuperSub, Upload.upload_room_images);

module.exports = router;
