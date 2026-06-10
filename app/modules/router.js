let router = require('express').Router();
const uploadRoute = require('./uploads/uploadRoute.js');
const bookingRoute = require('./Booking/bookingRoute.js');
const contactRoute = require('./Contact/contactRoute.js');
const promoRoute = require('./Promo/promoRoute.js');
const roomRoute = require('./Rooms/roomRoute.js');
const cartRoute = require('./Cart/cartRoute.js');
const superAdminRoute = require('./SuperAdmin/superAdminRoute.js');
const authConfig = require('../config/auth.config.js');

/*********************************************************************************/
/***************************** Available Routes **********************************/
/*******************************************************************************/

router.use(authConfig.API_URL + 'superadmin', superAdminRoute);
router.use(authConfig.API_URL + 'upload', uploadRoute);
router.use(authConfig.API_URL + 'booking', bookingRoute);
router.use(authConfig.API_URL + 'contact', contactRoute);
router.use(authConfig.API_URL + 'promo', promoRoute);
router.use(authConfig.API_URL + 'rooms', roomRoute);
router.use(authConfig.API_URL + 'cabin', roomRoute);
router.use(authConfig.API_URL + 'cart', cartRoute);

module.exports = router;
