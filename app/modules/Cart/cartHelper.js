const mongoose = require('mongoose');
const Room = require('../Rooms/roomModel');
const {
    getAllRoomBlockingBookings,
    resolveBookingQuantity,
    computeNights,
    toDateOnly
} = require('../Rooms/roomAvailabilityHelper');
const { evaluateRoomStay } = require('../Rooms/roomWebsiteHelper');
const { normalizeCurrencyCode, shapeMoneyFields } = require('../../helper/currencyHelper');
const msg = require('./cartMessages');

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

const shapeRoomImagesForSnapshot = (room) =>
    (room.images || [])
        .filter((img) => img && String(img.url || '').trim())
        .map((img, index) => ({
            _id: img._id,
            url: String(img.url).trim(),
            alt: room.title || '',
            order: Number.isFinite(Number(img.order)) ? Number(img.order) : index
        }))
        .sort((a, b) => a.order - b.order);

const buildStayFromCartItem = (item) => ({
    checkInDate: item.checkInDate,
    checkOutDate: item.checkOutDate,
    adults: item.adults,
    children: item.children,
    requestedQuantity: item.quantity,
    hasStayDates: true,
    validStayDates: item.checkOutDate > item.checkInDate
});

const evaluateCartItemAvailability = async (roomId, input, options = {}) => {
    const room = await loadActiveRoom(roomId);
    if (!room) {
        return { ok: false, message: msg.ROOM_NOT_FOUND };
    }

    const quantityResolution = resolveBookingQuantity(room, input);
    if (quantityResolution.invalidQuantity) {
        return { ok: false, message: msg.QUANTITY_MIN, room, invalidQuantity: true };
    }

    const resolvedQuantity = quantityResolution.quantity;

    const stay = {
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        adults: input.adults,
        children: input.children,
        requestedQuantity: resolvedQuantity,
        hasStayDates: true,
        validStayDates: input.checkOutDate > input.checkInDate
    };

    const bookings = await getAllRoomBlockingBookings(room._id, {
        excludeCartId: options.excludeCartId || null
    });
    const stayEval = evaluateRoomStay(room, bookings, stay, options);

    return {
        ok: stayEval.isAvailable,
        room,
        stayEval,
        message: stayEval.unavailableReason,
        resolvedQuantity
    };
};

const buildCartItemFromEvaluation = (room, input, stayEval) => {
    const nights = computeNights(input.checkInDate, input.checkOutDate);
    const pricePerNight = Number(room.price) || 0;
    const money = shapeMoneyFields(pricePerNight, room.currency);

    return {
        roomId: room._id,
        roomSnapshot: {
            title: room.title,
            slug: room.slug,
            type: room.type,
            price: pricePerNight,
            ...money,
            guests: room.guests,
            quantity: room.quantity || 1,
            images: shapeRoomImagesForSnapshot(room)
        },
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        adults: input.adults,
        children: input.children,
        quantity: stayEval.requestedQuantity || input.quantity || 1,
        nights,
        pricePerNight,
        subTotal: stayEval.subTotal,
        ...money,
        isAvailable: stayEval.isAvailable
    };
};

const recalculateCartTotals = (cart) => {
    const subTotal = cart.items.reduce((sum, item) => sum + (Number(item.subTotal) || 0), 0);
    cart.subTotal = Number(subTotal.toFixed(2));
    cart.currency = normalizeCurrencyCode(cart.items[0]?.currency || cart.currency);
    return cart;
};

const refreshCartAvailability = async (cart, options = {}) => {
    for (let i = 0; i < cart.items.length; i += 1) {
        const item = cart.items[i];
        const input = {
            checkInDate: item.checkInDate,
            checkOutDate: item.checkOutDate,
            adults: item.adults,
            children: item.children,
            quantity: item.quantity
        };
        const result = await evaluateCartItemAvailability(item.roomId, input, options);
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

const getCartItemUnavailableMessage = async (item, options = {}) => {
    const input = {
        checkInDate: item.checkInDate,
        checkOutDate: item.checkOutDate,
        adults: item.adults,
        children: item.children,
        quantity: item.quantity
    };
    const result = await evaluateCartItemAvailability(item.roomId, input, options);
    return (
        result.stayEval?.unavailableReason ||
        result.message ||
        (item.roomSnapshot?.title
            ? `${item.roomSnapshot.title} is not available for the selected dates. Please choose other dates.`
            : 'One or more cart items are not available')
    );
};

const shapeCartResponse = (cart) => ({
    cartId: cart.cartId,
    subTotal: cart.subTotal,
    currency: normalizeCurrencyCode(cart.currency),
    expiresAt: cart.expiresAt,
    items: cart.items.map((item) => {
        const itemMoney = shapeMoneyFields(item.pricePerNight, item.currency);
        const snapshotMoney = item.roomSnapshot
            ? shapeMoneyFields(item.roomSnapshot.price ?? item.pricePerNight, item.roomSnapshot.currency)
            : null;

        return {
            _id: item._id,
            roomId: item.roomId,
            roomSnapshot: item.roomSnapshot
                ? {
                      ...item.roomSnapshot,
                      ...(snapshotMoney || {})
                  }
                : item.roomSnapshot,
            checkInDate: item.checkInDate,
            checkOutDate: item.checkOutDate,
            adults: item.adults,
            children: item.children,
            quantity: item.quantity,
            nights: item.nights,
            pricePerNight: item.pricePerNight,
            subTotal: item.subTotal,
            ...itemMoney,
            isAvailable: item.isAvailable
        };
    }),
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
    getCartItemUnavailableMessage,
    shapeCartResponse
};
