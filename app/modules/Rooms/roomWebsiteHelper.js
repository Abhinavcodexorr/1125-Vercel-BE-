const {
    getAllRoomBlockingBookings,
    getOccupiedDateKeysForRange,
    getRoomBlockedDateData,
    getStayQuantityStatus,
    getRoomQuantity,
    getRoomDisplayName,
    formatRoomMaxGuestCapacity,
    getMaxGuestsForStay,
    getCapacityUnitsForStay,
    isMultiQuantityRoom,
    formatDateKey,
    computeNights,
    toDateOnly
} = require('./roomAvailabilityHelper');
const {
    CURRENCY_SYMBOLS,
    shapeMoneyFields
} = require('../../helper/currencyHelper');

const parsePositiveInt = (value, fallback) => {
    const num = parseInt(value, 10);
    return Number.isFinite(num) && num > 0 ? num : fallback;
};

const parseStayQuery = (query) => {
    const checkInDate = query.checkInDate || query.checkinDate || null;
    const checkOutDate = query.checkOutDate || query.checkoutDate || null;
    const adults = parsePositiveInt(query.adult ?? query.adults, null);
    const children = parsePositiveInt(query.children ?? query.child, 0);
    const requestedQuantity = parsePositiveInt(query.quantity ?? query.qty ?? query.units, null);

    let checkIn = null;
    let checkOut = null;

    if (checkInDate) checkIn = toDateOnly(checkInDate);
    if (checkOutDate) checkOut = toDateOnly(checkOutDate);

    const hasStayDates = !!(checkIn && checkOut);
    const validStayDates = hasStayDates && checkOut > checkIn;

    return {
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults,
        children,
        requestedQuantity,
        hasStayDates,
        validStayDates,
        page: parsePositiveInt(query.page, 1),
        limit: Math.min(parsePositiveInt(query.limit, 10), 50)
    };
};

const formatPrice = (price, currency = 'GHS') => shapeMoneyFields(price, currency).formattedPrice;

const expandBlockedDatesPalmStyle = (blockedRanges = []) => {
    const expanded = [];
    let blockId = 0;

    blockedRanges.forEach((block) => {
        const occupiedDates = getOccupiedDateKeysForRange(block.startDate, block.endDate);
        occupiedDates.forEach((dateKey) => {
            const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
            const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);
            expanded.push({
                blockId,
                _id: block._id,
                startDate: dayStart.toISOString(),
                endDate: dayEnd.toISOString(),
                date: dayStart.toISOString(),
                isSingleDate: true,
                reason: block.reason || 'Blocked by admin',
                duration: computeNights(block.startDate, block.endDate) || 1
            });
            blockId += 1;
        });
    });

    return expanded;
};

const bookingConflictsStay = (bookings, checkIn, checkOut) => {
    const requestCheckIn = toDateOnly(checkIn);
    const requestCheckOut = toDateOnly(checkOut);
    if (!requestCheckIn || !requestCheckOut) return null;

    return (
        bookings.find((booking) => {
            const bookingCheckIn = toDateOnly(booking.checkInDate);
            const bookingCheckOut = toDateOnly(booking.checkOutDate);
            return requestCheckIn < bookingCheckOut && requestCheckOut > bookingCheckIn;
        }) || null
    );
};

const evaluateRoomStay = (room, bookings, stay, options = {}) => {
    const roomName = getRoomDisplayName(room);
    const quantity = getRoomQuantity(room);
    const blockedDatesExpanded = expandBlockedDatesPalmStyle(
        getRoomBlockedDateData(room.blockedDates || []).blocked
    );

    // Default 1 unit when quantity omitted; use provided value when sent in query/body
    const requestedQuantity =
        stay.requestedQuantity != null && stay.requestedQuantity > 0
            ? stay.requestedQuantity
            : 1;

    const result = {
        isAvailable: true,
        quantity,
        availableUnits: quantity,
        bookedUnits: 0,
        requestedQuantity,
        blockedDates: blockedDatesExpanded,
        unavailableReason: null,
        nights: 0,
        subTotal: 0
    };

    if (!stay.hasStayDates) {
        return result;
    }

    if (!stay.validStayDates) {
        return {
            ...result,
            isAvailable: false,
            unavailableReason: 'Invalid check-in or check-out dates'
        };
    }

    result.nights = computeNights(stay.checkInDate, stay.checkOutDate);
    result.subTotal = (Number(room.price) || 0) * result.nights * requestedQuantity;

    const quantityStatus = getStayQuantityStatus(
        room,
        bookings,
        stay.checkInDate,
        stay.checkOutDate,
        requestedQuantity
    );
    result.quantity = quantityStatus.quantity;
    result.availableUnits = quantityStatus.availableUnits;
    result.bookedUnits = quantityStatus.bookedUnits;
    result.requestedQuantity = quantityStatus.requestedQuantity || requestedQuantity;

    const totalGuests = (stay.adults || 0) + (stay.children || 0);
    const maxTotalGuests = getMaxGuestsForStay(room, result.requestedQuantity);
    result.maxTotalGuests = maxTotalGuests;
    result.maxGuestsPerChalet = Math.max(parseInt(room.guests, 10) || 1, 1);

    if (!options.skipGuestCapacity && totalGuests > 0 && totalGuests > maxTotalGuests) {
        return {
            ...result,
            isAvailable: false,
            unavailableReason: formatRoomMaxGuestCapacity(room, result.requestedQuantity),
            failureType: 'capacity'
        };
    }

    if (!quantityStatus.available) {
        const bookingConflict = bookingConflictsStay(bookings, stay.checkInDate, stay.checkOutDate);
        return {
            ...result,
            isAvailable: false,
            unavailableReason: quantityStatus.reason,
            failureType: 'quantity',
            conflictingBooking: bookingConflict
                ? {
                      bookingReference: bookingConflict.bookingReference,
                      checkInDate: bookingConflict.checkInDate,
                      checkOutDate: bookingConflict.checkOutDate
                  }
                : null
        };
    }

    return { ...result, failureType: null };
};

const shapeStayEvalForWebsite = (stayEval) => ({
    isAvailable: stayEval.isAvailable,
    quantity: stayEval.quantity,
    availableUnits: stayEval.availableUnits,
    bookedUnits: stayEval.bookedUnits,
    requestedQuantity: stayEval.requestedQuantity,
    maxGuestsPerChalet: stayEval.maxGuestsPerChalet ?? null,
    maxTotalGuests: stayEval.maxTotalGuests ?? null,
    nights: stayEval.nights,
    subTotal: stayEval.subTotal,
    conflictingBooking: stayEval.conflictingBooking || null,
    unavailableReason: stayEval.unavailableReason || null,
    failureType: stayEval.failureType || null
});

const attachStayAvailabilityToRoom = (room, stay, stayEval) => {
    const shaped = shapeRoomBaseForWebsite(room);
    if (!stay.hasStayDates) {
        return shaped;
    }

    if (!stay.validStayDates) {
        return {
            ...shaped,
            availability: {
                isAvailable: false,
                unavailableReason: 'checkOutDate must be after checkInDate'
            }
        };
    }

    const availability = shapeStayEvalForWebsite(stayEval);
    const showQuantityPicker = isMultiQuantityRoom(room);

    return {
        ...shaped,
        availability: {
            ...availability,
            checkInDate: formatDateKey(stay.checkInDate),
            checkOutDate: formatDateKey(stay.checkOutDate),
            adults: stay.adults,
            children: stay.children,
            maxGuestsPerChalet: room.guests,
            maxTotalGuests: getMaxGuestsForStay(room, availability.requestedQuantity || 1),
            showQuantityPicker,
            maxSelectableQuantity: showQuantityPicker ? availability.availableUnits : 1
        }
    };
};

const shapeRoomBaseForWebsite = (room) => {
    const money = shapeMoneyFields(room.price, room.currency);

    return {
        _id: room._id,
        name: room.title,
        title: room.title,
        type: room.type,
        slug: room.slug,
        description: room.description || '',
        size: room.size,
        unit: room.unit || 'sq ft',
        pricePerNight: room.price,
        price: room.price,
        ...money,
        guests: room.guests,
        quantity: getRoomQuantity(room),
        adultCapacity: room.guests,
        childCapacity: 0,
        amenities: room.amenities || [],
        images: (room.images || []).map((img, index) => ({
            _id: img._id,
            url: img.url,
            alt: room.title,
            order: img.order ?? index
        })),
        isActive: room.isActive,
        isDeleted: room.isDeleted
    };
};

const filterRoomsForStay = (rooms, stay) => {
    const totalGuests = (stay.adults || 0) + (stay.children || 0);
    if (!totalGuests) return rooms;

    return rooms.filter((room) => {
        const unitsForCapacity = stay.requestedQuantity
            ? stay.requestedQuantity
            : isMultiQuantityRoom(room)
              ? getRoomQuantity(room)
              : 1;
        return getMaxGuestsForStay(room, unitsForCapacity) >= totalGuests;
    });
};

module.exports = {
    parseStayQuery,
    formatPrice,
    evaluateRoomStay,
    shapeStayEvalForWebsite,
    attachStayAvailabilityToRoom,
    shapeRoomBaseForWebsite,
    filterRoomsForStay,
    getAllRoomBlockingBookings,
    CURRENCY_SYMBOLS
};
