const mongoose = require('mongoose');
const Room = require('../Rooms/roomModel');
const { getAllRoomBlockingBookings } = require('../Rooms/roomAvailabilityHelper');
const { evaluateRoomStay } = require('../Rooms/roomWebsiteHelper');
const { toDateOnly, computeNights } = require('../Rooms/roomAvailabilityHelper');

const isObjectId = (value) =>
    mongoose.Types.ObjectId.isValid(value) &&
    String(new mongoose.Types.ObjectId(value)) === String(value);

const parseRequestedQuantity = (body) => {
    const raw = body.quantity ?? body.qty ?? body.units;
    if (raw == null || raw === '') {
        return { quantity: 1, quantityProvided: false };
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return { quantity: null, quantityProvided: true };
    }
    return { quantity: parsed, quantityProvided: true };
};

const parseCartItemInput = (body) => {
    const checkIn = toDateOnly(body.checkInDate);
    const checkOut = toDateOnly(body.checkOutDate);
    const adults = parseInt(body.adults ?? body.adult, 10);
    const children = parseInt(body.children ?? body.child ?? 0, 10);
    const { quantity, quantityProvided } = parseRequestedQuantity(body);

    return {
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: Number.isFinite(adults) && adults > 0 ? adults : null,
        children: Number.isFinite(children) && children >= 0 ? children : 0,
        quantity,
        quantityProvided
    };
};

const loadActiveRoom = async (roomId) =>
    Room.findOne({ _id: roomId, isDeleted: false, isActive: true }).lean();

const buildStayFromCartItem = (item) => ({
    checkInDate: item.checkInDate,
    checkOutDate: item.checkOutDate,
    adults: item.adults,
    children: item.children,
    requestedQuantity: item.quantity,
    hasStayDates: true,
    validStayDates: item.checkOutDate > item.checkInDate
});

const evaluateCartItemAvailability = async (roomId, input) => {
    const room = await loadActiveRoom(roomId);
    if (!room) {
        return { ok: false, message: 'Room not found' };
    }

    const stay = {
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        adults: input.adults,
        children: input.children,
        requestedQuantity: input.quantity,
        hasStayDates: true,
        validStayDates: input.checkOutDate > input.checkInDate
    };

    const bookings = await getAllRoomBlockingBookings(room._id);
    const stayEval = evaluateRoomStay(room, bookings, stay);

    return {
        ok: stayEval.isAvailable,
        room,
        stayEval,
        message: stayEval.unavailableReason
    };
};

const buildCartItemFromEvaluation = (room, input, stayEval) => {
    const nights = computeNights(input.checkInDate, input.checkOutDate);
    const pricePerNight = Number(room.price) || 0;

    return {
        roomId: room._id,
        roomSnapshot: {
            title: room.title,
            slug: room.slug,
            type: room.type,
            price: pricePerNight,
            currency: room.currency || 'GHS',
            guests: room.guests,
            quantity: room.quantity || 1
        },
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        adults: input.adults,
        children: input.children,
        quantity: input.quantity,
        nights,
        pricePerNight,
        subTotal: stayEval.subTotal,
        currency: room.currency || 'GHS',
        isAvailable: stayEval.isAvailable
    };
};

const recalculateCartTotals = (cart) => {
    const subTotal = cart.items.reduce((sum, item) => sum + (Number(item.subTotal) || 0), 0);
    cart.subTotal = Number(subTotal.toFixed(2));
    cart.currency = cart.items[0]?.currency || cart.currency || 'GHS';
    return cart;
};

const refreshCartAvailability = async (cart) => {
    for (let i = 0; i < cart.items.length; i += 1) {
        const item = cart.items[i];
        const input = {
            checkInDate: item.checkInDate,
            checkOutDate: item.checkOutDate,
            adults: item.adults,
            children: item.children,
            quantity: item.quantity
        };
        const result = await evaluateCartItemAvailability(item.roomId, input);
        if (!result.ok || !result.room) {
            item.isAvailable = false;
            continue;
        }
        const rebuilt = buildCartItemFromEvaluation(result.room, input, result.stayEval);
        cart.items[i] = { ...item.toObject(), ...rebuilt };
    }
    recalculateCartTotals(cart);
    return cart;
};

const shapeCartResponse = (cart) => ({
    cartId: cart.cartId,
    subTotal: cart.subTotal,
    currency: cart.currency,
    expiresAt: cart.expiresAt,
    items: cart.items.map((item) => ({
        _id: item._id,
        roomId: item.roomId,
        roomSnapshot: item.roomSnapshot,
        checkInDate: item.checkInDate,
        checkOutDate: item.checkOutDate,
        adults: item.adults,
        children: item.children,
        quantity: item.quantity,
        nights: item.nights,
        pricePerNight: item.pricePerNight,
        subTotal: item.subTotal,
        currency: item.currency,
        isAvailable: item.isAvailable
    })),
    allAvailable: cart.items.every((item) => item.isAvailable),
    updatedAt: cart.updatedAt
});

module.exports = {
    isObjectId,
    parseRequestedQuantity,
    parseCartItemInput,
    loadActiveRoom,
    buildStayFromCartItem,
    evaluateCartItemAvailability,
    buildCartItemFromEvaluation,
    recalculateCartTotals,
    refreshCartAvailability,
    shapeCartResponse
};
