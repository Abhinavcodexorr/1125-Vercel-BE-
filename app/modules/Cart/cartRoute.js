const express = require('express');
const router = express.Router();
const cartController = require('./cartController');

router.post('/add', cartController.addToCart);
router.get('/:cartId/check-availability', cartController.checkCartAvailability);
router.get('/:cartId', cartController.getCart);
router.delete('/:cartId/items/:itemId', cartController.removeCartItem);
router.delete('/:cartId', cartController.clearCart);

module.exports = router;
