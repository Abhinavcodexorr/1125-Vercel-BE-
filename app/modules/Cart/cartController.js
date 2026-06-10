const crypto = require('crypto');
const Cart = require('./cartModel');
const response = require('../../helper/response');
const msg = require('./cartMessages');
const {
    parseCartItemInput,
    evaluateCartItemAvailability,
    buildCartItemFromEvaluation,
    recalculateCartTotals,
    refreshCartAvailability,
    shapeCartResponse
} = require('./cartHelper');

const CART_TTL_HOURS = 72;

const getCartExpiry = () => {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CART_TTL_HOURS);
    return expiresAt;
};

const findCart = async (cartId) => Cart.findOne({ cartId });

const addToCart = async (req, res) => {
    try {
        const { roomId, cartId } = req.body;

        if (!roomId) {
            return response.error400(res, msg.ROOM_ID_REQUIRED);
        }

        const input = parseCartItemInput(req.body);
        if (!input.checkInDate || !input.checkOutDate) {
            return response.error400(res, msg.STAY_DATES_REQUIRED);
        }
        if (input.checkOutDate <= input.checkInDate) {
            return response.error400(res, msg.STAY_DATES_INVALID);
        }
        if (!input.adults) {
            return response.error400(res, msg.ADULTS_REQUIRED);
        }
        if (!input.quantity) {
            return response.error400(res, msg.QUANTITY_MIN);
        }

        const evaluation = await evaluateCartItemAvailability(roomId, input);
        if (!evaluation.ok || !evaluation.room) {
            return response.error400(res, evaluation.message || msg.ROOM_NOT_FOUND);
        }
        if (!evaluation.stayEval.isAvailable) {
            return response.error400(res, msg.ROOM_NOT_AVAILABLE, null, {
                data: {
                    isAvailable: false,
                    unavailableReason: evaluation.stayEval.unavailableReason,
                    availableUnits: evaluation.stayEval.availableUnits,
                    requestedQuantity: input.quantity
                }
            });
        }

        const cartItem = buildCartItemFromEvaluation(evaluation.room, input, evaluation.stayEval);

        let cart = cartId ? await findCart(cartId) : null;
        if (!cart) {
            cart = new Cart({
                cartId: crypto.randomUUID(),
                items: [cartItem],
                expiresAt: getCartExpiry()
            });
        } else {
            cart.items.push(cartItem);
            cart.expiresAt = getCartExpiry();
        }

        recalculateCartTotals(cart);
        await cart.save();

        return response.created201(res, msg.ITEM_ADDED, shapeCartResponse(cart));
    } catch (error) {
        console.error('Add to cart error:', error.message);
        return response.serverError500(res, 'Failed to add item to cart', error.message);
    }
};

const getCart = async (req, res) => {
    try {
        const cart = await findCart(req.params.cartId);
        if (!cart) {
            return response.notFound404(res, msg.CART_NOT_FOUND);
        }

        await refreshCartAvailability(cart);
        await cart.save();

        return response.success200(res, msg.CART_RETRIEVED, shapeCartResponse(cart));
    } catch (error) {
        console.error('Get cart error:', error.message);
        return response.serverError500(res, 'Failed to retrieve cart', error.message);
    }
};

const checkCartAvailability = async (req, res) => {
    try {
        const cart = await findCart(req.params.cartId);
        if (!cart) {
            return response.notFound404(res, msg.CART_NOT_FOUND);
        }
        if (!cart.items.length) {
            return response.error400(res, msg.CART_EMPTY);
        }

        await refreshCartAvailability(cart);
        await cart.save();

        const shaped = shapeCartResponse(cart);
        if (!shaped.allAvailable) {
            return response.error400(res, msg.ROOM_NOT_AVAILABLE, null, { data: shaped });
        }

        return response.success200(res, msg.AVAILABILITY_CHECKED, shaped);
    } catch (error) {
        console.error('Check cart availability error:', error.message);
        return response.serverError500(res, 'Failed to check cart availability', error.message);
    }
};

const removeCartItem = async (req, res) => {
    try {
        const cart = await findCart(req.params.cartId);
        if (!cart) {
            return response.notFound404(res, msg.CART_NOT_FOUND);
        }

        const before = cart.items.length;
        cart.items = cart.items.filter((item) => String(item._id) !== String(req.params.itemId));
        if (cart.items.length === before) {
            return response.notFound404(res, msg.CART_ITEM_NOT_FOUND);
        }

        recalculateCartTotals(cart);
        cart.expiresAt = getCartExpiry();
        await cart.save();

        return response.success200(res, msg.ITEM_REMOVED, shapeCartResponse(cart));
    } catch (error) {
        console.error('Remove cart item error:', error.message);
        return response.serverError500(res, 'Failed to remove cart item', error.message);
    }
};

const clearCart = async (req, res) => {
    try {
        const cart = await findCart(req.params.cartId);
        if (!cart) {
            return response.notFound404(res, msg.CART_NOT_FOUND);
        }

        cart.items = [];
        cart.subTotal = 0;
        await cart.save();

        return response.success200(res, msg.CART_CLEARED, shapeCartResponse(cart));
    } catch (error) {
        console.error('Clear cart error:', error.message);
        return response.serverError500(res, 'Failed to clear cart', error.message);
    }
};

module.exports = {
    addToCart,
    getCart,
    checkCartAvailability,
    removeCartItem,
    clearCart
};
