const Booking = require('../Booking/bookingModel');
const Room = require('./roomModel');
const { ROOM_COMBO_CONFLICTS } = require('../../config/roomConflict.config');

/** Paid, confirmed stays always block availability. */
const BLOCKING_STATUSES = ['Confirmed', 'Checked-In', 'Checked-Out'];
const BLOCKING_PAYMENT_STATUSES = ['paid'];

const normalizeRoomId = (id) => String(id || '');

/**
 * Room IDs whose bookings should count against availability for `roomId`.
 * Suite ← own + Standard + Deluxe bookings
 * Standard/Deluxe ← own + Suite bookings (not the other component)
 */
const getAvailabilityBlockingRoomIds = (roomId) => {
    const id = normalizeRoomId(roomId);
    if (!id) return [];

    const ids = new Set([id]);
    (ROOM_COMBO_CONFLICTS || []).forEach((combo) => {
        const comboId = normalizeRoomId(combo.comboRoomId);
        const components = (combo.componentRoomIds || []).map(normalizeRoomId).filter(Boolean);
        if (!comboId || !components.length) return;

        if (id === comboId) {
            components.forEach((componentId) => ids.add(componentId));
            return;
        }
        if (components.includes(id)) {
            ids.add(comboId);
        }
    });

    return [...ids];
};

/** Expand a list of room IDs so conflict partners are included in bulk fetches. */
const expandRoomIdsWithConflicts = (roomIds = []) => {
    const set = new Set();
    roomIds.forEach((roomId) => {
        getAvailabilityBlockingRoomIds(roomId).forEach((id) => set.add(id));
    });
    return [...set];
};

/**
 * From a roomId → bookings map, collect bookings that affect this room's availability.
 */
const collectBookingsForRoomAvailability = (roomId, bookingsByRoom = {}) => {
    const collected = [];
    getAvailabilityBlockingRoomIds(roomId).forEach((id) => {
        const list = bookingsByRoom[normalizeRoomId(id)];
        if (Array.isArray(list) && list.length) {
            collected.push(...list);
        }
    });
    return collected;
};

/** Admin blocked-date ranges from conflict-partner rooms (Suite ↔ Standard/Deluxe). */
const getConflictPartnerBlockedDateDocs = async (roomId) => {
    const selfId = normalizeRoomId(roomId);
    const partnerIds = getAvailabilityBlockingRoomIds(roomId).filter((id) => id && id !== selfId);
    if (!partnerIds.length) return [];

    const partners = await Room.find({
        _id: { $in: partnerIds },
        isDeleted: false
    })
        .select('blockedDates')
        .lean();

    return partners.flatMap((partner) => partner.blockedDates || []);
};

/** Room copy with own + partner admin blocks (for stay / calendar availability). */
const withEffectiveBlockedDates = async (room) => {
    if (!room?._id) return room;
    const partnerBlocked = await getConflictPartnerBlockedDateDocs(room._id);
    if (!partnerBlocked.length) return room;
    return {
        ...room,
        blockedDates: [...(room.blockedDates || []), ...partnerBlocked]
    };
};

const getBookingHoldMinutes = () => {
    const parsed = parseInt(process.env.ROOM_BOOKING_HOLD_MINUTES, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
};

const getHoldExpiresAt = (fromDate = new Date()) => {
    const expiresAt = new Date(fromDate);
    expiresAt.setMinutes(expiresAt.getMinutes() + getBookingHoldMinutes());
    return expiresAt;
};

const roomBlockingBookingQuery = (roomIdOrIds) => {
    const now = new Date();
    const holdCutoff = new Date(now.getTime() - getBookingHoldMinutes() * 60 * 1000);

    const query = {
        isDeleted: false,
        checkInDate: { $exists: true, $ne: null },
        checkOutDate: { $exists: true, $ne: null },
        $or: [
            {
                status: { $in: BLOCKING_STATUSES },
                paymentStatus: { $in: BLOCKING_PAYMENT_STATUSES }
            },
            {
                status: 'Pending',
                paymentStatus: { $in: ['incomplete', 'pending'] },
                roomId: { $exists: true, $ne: null },
                $or: [
                    { holdExpiresAt: { $gt: now } },
                    { holdExpiresAt: { $exists: false }, createdAt: { $gte: holdCutoff } }
                ]
            }
        ]
    };

    if (roomIdOrIds != null) {
        const ids = (Array.isArray(roomIdOrIds) ? roomIdOrIds : [roomIdOrIds]).filter(Boolean);
        if (ids.length === 1) {
            query.roomId = ids[0];
        } else if (ids.length > 1) {
            query.roomId = { $in: ids };
        }
    }

    return query;
};

const BLOCKING_BOOKING_SELECT =
    'roomId roomQuantity bookingReference cartId checkInDate checkOutDate status paymentStatus adults children holdExpiresAt createdAt';

/** A still-unpaid room hold that the cart owner created themselves. */
const isOwnPendingCartHold = (booking, excludeCartId) => {
    if (!excludeCartId || !booking?.cartId) return false;
    if (String(booking.cartId) !== String(excludeCartId)) return false;
    return (
        booking.status === 'Pending' &&
        ['incomplete', 'pending'].includes(booking.paymentStatus) &&
        Boolean(booking.roomId)
    );
};
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How far ahead to list open dates (full array, not paginated). Override via ROOM_AVAILABILITY_DAYS in .env */
const DEFAULT_AVAILABLE_HORIZON_DAYS =
    parseInt(process.env.ROOM_AVAILABILITY_DAYS, 10) || 1095;

const toDateOnly = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
};

const formatDateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const enumerateDateKeys = (startDate, endDate) => {
    const dates = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
        dates.push(formatDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
};

const computeNights = (checkInDate, checkOutDate) => {
    const checkIn = toDateOnly(checkInDate);
    const checkOut = toDateOnly(checkOutDate);
    if (!checkIn || !checkOut || checkOut <= checkIn) return 0;
    return Math.round((checkOut - checkIn) / MS_PER_DAY);
};

const getOccupiedDateKeysForBooking = (checkInDate, checkOutDate) => {
    const checkIn = toDateOnly(checkInDate);
    const checkOut = toDateOnly(checkOutDate);
    if (!checkIn || !checkOut || checkOut <= checkIn) return [];

    const end = new Date(checkOut);
    end.setDate(end.getDate() - 1);
    if (end < checkIn) return [];

    return enumerateDateKeys(checkIn, end);
};

const getRoomQuantity = (room) => {
    const quantity = parseInt(room?.quantity, 10);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const getQuantityOverrideMap = (room) => {
    const map = new Map();
    (room?.quantityOverrides || []).forEach((item) => {
        const key = formatDateKey(toDateOnly(item?.date));
        const qty = parseInt(item?.quantity, 10);
        if (key && Number.isFinite(qty) && qty >= 0) {
            map.set(key, qty);
        }
    });
    return map;
};

/** Sellable units for one date (admin override capped at room.quantity). */
const getEffectiveQuantityForDate = (room, dateKey, overrideMap = null) => {
    const base = getRoomQuantity(room);
    const map = overrideMap || getQuantityOverrideMap(room);
    if (!dateKey || !map.has(dateKey)) return base;
    const override = map.get(dateKey);
    return Math.min(base, Math.max(0, override));
};

const shapeQuantityOverridesForApi = (room) =>
    (room?.quantityOverrides || [])
        .map((item) => {
            const date = toDateOnly(item?.date);
            if (!date) return null;
            return {
                _id: item._id,
                date: formatDateKey(date),
                quantity: parseInt(item.quantity, 10)
            };
        })
        .filter(Boolean);

/** Only rooms with quantity > 1 need quantity in cart / booking requests. */
const isMultiQuantityRoom = (room) => {
    const quantity = parseInt(room?.quantity, 10);
    return Number.isFinite(quantity) && quantity > 1;
};

const resolveBookingQuantity = (room, { quantity, quantityProvided }) => {
    if (!isMultiQuantityRoom(room)) {
        return { quantity: 1, quantityProvided: false, invalidQuantity: false };
    }

    // Explicitly sent but invalid (e.g. quantity=0 from client)
    if (quantityProvided === true && (quantity == null || quantity < 1)) {
        return { quantity: null, quantityProvided: true, invalidQuantity: true };
    }

    // Omitted on request → default 1 unit
    if (quantityProvided === false) {
        return { quantity: 1, quantityProvided: false, invalidQuantity: false };
    }

    // Valid quantity from request, cart item, or booking create (quantityProvided may be unset)
    const parsed = parseInt(quantity, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
        return { quantity: parsed, quantityProvided: true, invalidQuantity: false };
    }

    return { quantity: 1, quantityProvided: false, invalidQuantity: false };
};

const getBookingUnitCount = (booking) => {
    const units = parseInt(booking?.roomQuantity ?? booking?.quantity, 10);
    return Number.isFinite(units) && units > 0 ? units : 1;
};

const buildBookingCountByDate = (bookings) => {
    const counts = new Map();
    bookings.forEach((booking) => {
        const units = getBookingUnitCount(booking);
        getOccupiedDateKeysForBooking(booking.checkInDate, booking.checkOutDate).forEach((dateKey) => {
            counts.set(dateKey, (counts.get(dateKey) || 0) + units);
        });
    });
    return counts;
};

const getAllRoomBlockingBookings = async (roomId, options = {}) => {
    const { excludeBookingIds = [], excludeCartId = null } = options;
    const excludeSet = new Set(excludeBookingIds.map(String));
    const roomIds = getAvailabilityBlockingRoomIds(roomId);
    const bookings = await Booking.find(roomBlockingBookingQuery(roomIds))
        .select(BLOCKING_BOOKING_SELECT)
        .sort({ checkInDate: 1 })
        .lean();

    if (!excludeSet.size && !excludeCartId) return bookings;

    return bookings.filter((booking) => {
        if (excludeSet.has(String(booking._id))) return false;
        if (isOwnPendingCartHold(booking, excludeCartId)) return false;
        return true;
    });
};

const getRoomBlockingBookingsByRoomIds = async (roomIds = []) => {
    const expandedIds = expandRoomIdsWithConflicts(roomIds);
    if (!expandedIds.length) return [];
    return Booking.find(roomBlockingBookingQuery(expandedIds))
        .select(BLOCKING_BOOKING_SELECT)
        .sort({ checkInDate: 1 })
        .lean();
};

const getOccupiedDateKeysForRange = (startDate, endDate) =>
    getOccupiedDateKeysForBooking(startDate, endDate);

const getRoomBlockedDateData = (blockedDates = []) => {
    const blockedDateSet = new Set();
    const blocked = blockedDates.map((block) => {
        const occupiedDates = getOccupiedDateKeysForRange(block.startDate, block.endDate);
        occupiedDates.forEach((dateKey) => blockedDateSet.add(dateKey));

        const start = toDateOnly(block.startDate);
        const end = toDateOnly(block.endDate);

        return {
            _id: block._id,
            startDate: start ? formatDateKey(start) : block.startDate,
            endDate: end ? formatDateKey(end) : block.endDate,
            reason: block.reason || '',
            occupiedDates,
            createdAt: block.createdAt,
            updatedAt: block.updatedAt
        };
    });

    return {
        blocked,
        blockedDates: [...blockedDateSet].sort()
    };
};

const getAvailableWindowEnd = (bookings, blockedDates, today) => {
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + DEFAULT_AVAILABLE_HORIZON_DAYS);

    for (const booking of bookings) {
        const checkOut = toDateOnly(booking.checkOutDate);
        if (checkOut && checkOut > windowEnd) {
            windowEnd.setTime(checkOut.getTime());
        }
    }

    for (const block of blockedDates || []) {
        const blockEnd = toDateOnly(block.endDate);
        if (blockEnd && blockEnd > windowEnd) {
            windowEnd.setTime(blockEnd.getTime());
        }
    }

    return windowEnd;
};

const buildFullRoomAvailability = (room, bookings, options = {}) => {
    const maxQuantity = getRoomQuantity(room);
    const overrideMap = getQuantityOverrideMap(room);
    const bookingCountByDate = buildBookingCountByDate(bookings);

    const dayQuantity = (dateKey) => getEffectiveQuantityForDate(room, dateKey, overrideMap);
    const dayAvailableUnits = (dateKey, bookedCount, blocked) => {
        if (blocked) return 0;
        return Math.max(dayQuantity(dateKey) - bookedCount, 0);
    };
    const dayFullyBooked = (dateKey, bookedCount, blocked) =>
        blocked || bookedCount >= dayQuantity(dateKey);

    const booked = bookings.map((booking) => {
        const occupiedDates = getOccupiedDateKeysForBooking(booking.checkInDate, booking.checkOutDate);
        return {
            bookingReference: booking.bookingReference,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            nights: computeNights(booking.checkInDate, booking.checkOutDate),
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            occupiedDates
        };
    });

    const bookingBookedDates = [...bookingCountByDate.keys()].sort();

    // Own blocks = what admin can edit; effective = own + conflict-partner blocks
    const ownBlockedDocs = options.ownBlockedDates ?? room.blockedDates ?? [];
    const effectiveBlockedDocs = options.effectiveBlockedDates ?? room.blockedDates ?? [];
    const ownBlockedData = getRoomBlockedDateData(ownBlockedDocs);
    const { blockedDates: adminBlockedDates } = getRoomBlockedDateData(effectiveBlockedDocs);
    const blockedDateSet = new Set(adminBlockedDates);

    const fullyBookedDates = [];
    const partiallyBookedDates = [];
    const occupancyByDate = {};

    const upsertOccupancy = (dateKey, bookedCount, blocked) => {
        const qty = dayQuantity(dateKey);
        const availableUnits = dayAvailableUnits(dateKey, bookedCount, blocked);
        occupancyByDate[dateKey] = {
            bookedCount,
            availableUnits,
            quantity: qty,
            maxQuantity: maxQuantity,
            overrideQuantity: overrideMap.has(dateKey) ? overrideMap.get(dateKey) : null,
            blocked
        };
        if (dayFullyBooked(dateKey, bookedCount, blocked)) {
            fullyBookedDates.push(dateKey);
        } else if (bookedCount > 0) {
            partiallyBookedDates.push(dateKey);
        }
    };

    bookingCountByDate.forEach((bookedCount, dateKey) => {
        upsertOccupancy(dateKey, bookedCount, blockedDateSet.has(dateKey));
    });

    blockedDateSet.forEach((dateKey) => {
        if (!occupancyByDate[dateKey]) {
            upsertOccupancy(dateKey, bookingCountByDate.get(dateKey) || 0, true);
        } else if (!fullyBookedDates.includes(dateKey)) {
            fullyBookedDates.push(dateKey);
        }
    });

    fullyBookedDates.sort();
    partiallyBookedDates.sort();

    const unavailableDateSet = new Set(fullyBookedDates);
    const bookedDates = [...unavailableDateSet].sort();

    const today = toDateOnly(new Date());
    const windowEnd = getAvailableWindowEnd(bookings, effectiveBlockedDocs, today);
    const futureDateKeys = today <= windowEnd ? enumerateDateKeys(today, windowEnd) : [];
    const availableDates = futureDateKeys.filter((dateKey) => {
        if (blockedDateSet.has(dateKey)) return false;
        const bookedCount = bookingCountByDate.get(dateKey) || 0;
        return bookedCount < dayQuantity(dateKey);
    });

    futureDateKeys.forEach((dateKey) => {
        if (!occupancyByDate[dateKey]) {
            const blocked = blockedDateSet.has(dateKey);
            upsertOccupancy(dateKey, bookingCountByDate.get(dateKey) || 0, blocked);
        }
    });

    return {
        room: {
            _id: room._id,
            title: room.title,
            slug: room.slug,
            type: room.type,
            quantity: maxQuantity
        },
        booked,
        blocked: ownBlockedData.blocked,
        bookingBookedDates,
        // Own admin blocks only (what the admin panel edits)
        blockedDates: ownBlockedData.blockedDates,
        bookedDates,
        partiallyBookedDates,
        availableDates,
        occupancyByDate,
        quantityOverrides: shapeQuantityOverridesForApi(room),
        availableFrom: formatDateKey(today),
        availableUntil: formatDateKey(windowEnd),
        summary: {
            totalBookings: booked.length,
            totalBlockedRanges: ownBlockedData.blocked.length,
            totalBookingDays: bookingBookedDates.length,
            totalBlockedDays: ownBlockedData.blockedDates.length,
            totalUnavailableDays: bookedDates.length,
            totalPartiallyBookedDays: partiallyBookedDates.length,
            totalAvailableDays: availableDates.length,
            quantity: maxQuantity
        }
    };
};

const getMaxConcurrentBookings = (bookings) => {
    const bookingCountByDate = buildBookingCountByDate(bookings);
    let max = 0;
    bookingCountByDate.forEach((count) => {
        if (count > max) max = count;
    });
    return max;
};

const getRoomDisplayName = (room) => String(room?.title || room?.name || 'Room').trim();

const formatRoomNotAvailableForDates = (room) =>
    `${getRoomDisplayName(room)} is not available for the selected dates. Please choose other dates.`;

const formatRoomQuantityUnavailable = (room, availableUnits) =>
    `Only ${availableUnits} unit(s) available for the selected dates`;

const formatRoomMaxGuestCapacity = (room, requestedQuantity = 1) => {
    const perUnit = Math.max(parseInt(room?.guests, 10) || 1, 1);
    const units = isMultiQuantityRoom(room)
        ? Math.max(parseInt(requestedQuantity, 10) || 1, 1)
        : 1;
    const maxTotal = perUnit * units;
    if (units > 1) {
        return `Max. allowed capacity is ${maxTotal} Guests (${units} chalet(s) × ${perUnit} each)`;
    }
    return `Max. allowed capacity is ${maxTotal} Adults`;
};

const formatRoomMaxAdultCapacity = (room, requestedQuantity = 1) =>
    formatRoomMaxGuestCapacity(room, requestedQuantity);

const getCapacityUnitsForStay = (room, requestedQuantity = 1) =>
    isMultiQuantityRoom(room) ? Math.max(parseInt(requestedQuantity, 10) || 1, 1) : 1;

const getMaxGuestsForStay = (room, requestedQuantity = 1) => {
    const perUnit = Math.max(parseInt(room?.guests, 10) || 1, 1);
    return perUnit * getCapacityUnitsForStay(room, requestedQuantity);
};

const getStayQuantityStatus = (room, bookings, checkInDate, checkOutDate, requestedQuantity = 1) => {
    const maxQuantity = getRoomQuantity(room);
    const overrideMap = getQuantityOverrideMap(room);
    const bookingCountByDate = buildBookingCountByDate(bookings);
    const { blockedDates: adminBlockedDates } = getRoomBlockedDateData(room.blockedDates || []);
    const blockedDateSet = new Set(adminBlockedDates);
    const stayDates = getOccupiedDateKeysForBooking(checkInDate, checkOutDate);

    if (!stayDates.length) {
        return {
            quantity: maxQuantity,
            availableUnits: maxQuantity,
            bookedUnits: 0,
            available: true,
            reason: null,
            dateKey: null
        };
    }

    let maxBookedCount = 0;
    let minAvailableUnits = maxQuantity;

    for (const dateKey of stayDates) {
        const dayQty = getEffectiveQuantityForDate(room, dateKey, overrideMap);
        if (blockedDateSet.has(dateKey)) {
            const bookedCount = bookingCountByDate.get(dateKey) || 0;
            return {
                quantity: dayQty,
                availableUnits: 0,
                bookedUnits: bookedCount,
                available: false,
                reason: formatRoomNotAvailableForDates(room),
                dateKey
            };
        }

        const bookedCount = bookingCountByDate.get(dateKey) || 0;
        maxBookedCount = Math.max(maxBookedCount, bookedCount);
        minAvailableUnits = Math.min(
            minAvailableUnits,
            Math.max(dayQty - bookedCount, 0)
        );

        if (bookedCount >= dayQty) {
            return {
                quantity: dayQty,
                availableUnits: 0,
                bookedUnits: bookedCount,
                available: false,
                reason: formatRoomNotAvailableForDates(room),
                dateKey
            };
        }
    }

    const unitsNeeded = isMultiQuantityRoom(room)
        ? Math.max(parseInt(requestedQuantity, 10) || 1, 1)
        : 1;

    if (minAvailableUnits < unitsNeeded) {
        return {
            quantity: maxQuantity,
            availableUnits: minAvailableUnits,
            bookedUnits: maxBookedCount,
            requestedQuantity: unitsNeeded,
            available: false,
            reason: isMultiQuantityRoom(room)
                ? formatRoomQuantityUnavailable(room, minAvailableUnits)
                : formatRoomNotAvailableForDates(room),
            dateKey: null
        };
    }

    return {
        quantity: maxQuantity,
        availableUnits: minAvailableUnits,
        bookedUnits: maxBookedCount,
        requestedQuantity: unitsNeeded,
        available: true,
        reason: null,
        dateKey: null
    };
};

const isStayAvailableForQuantity = (room, bookings, checkInDate, checkOutDate) => {
    const status = getStayQuantityStatus(room, bookings, checkInDate, checkOutDate);
    return {
        available: status.available,
        reason: status.reason,
        dateKey: status.dateKey
    };
};

const validateRoomQuantityUpdate = (room, bookings, newQuantity) => {
    const maxBooked = getMaxConcurrentBookings(bookings);
    if (newQuantity < maxBooked) {
        return {
            valid: false,
            maxBooked,
            message: `quantity cannot be less than ${maxBooked} (maximum units already booked on overlapping dates)`
        };
    }
    return { valid: true, maxBooked };
};

module.exports = {
    getBookingHoldMinutes,
    getHoldExpiresAt,
    getRoomDisplayName,
    formatRoomNotAvailableForDates,
    formatRoomQuantityUnavailable,
    formatRoomMaxAdultCapacity,
    formatRoomMaxGuestCapacity,
    getCapacityUnitsForStay,
    getMaxGuestsForStay,
    getAllRoomBlockingBookings,
    getRoomBlockingBookingsByRoomIds,
    getAvailabilityBlockingRoomIds,
    expandRoomIdsWithConflicts,
    collectBookingsForRoomAvailability,
    getConflictPartnerBlockedDateDocs,
    withEffectiveBlockedDates,
    roomBlockingBookingQuery,
    buildFullRoomAvailability,
    getOccupiedDateKeysForBooking,
    getOccupiedDateKeysForRange,
    getRoomBlockedDateData,
    buildBookingCountByDate,
    getBookingUnitCount,
    getRoomQuantity,
    getQuantityOverrideMap,
    getEffectiveQuantityForDate,
    shapeQuantityOverridesForApi,
    isMultiQuantityRoom,
    resolveBookingQuantity,
    getMaxConcurrentBookings,
    getStayQuantityStatus,
    isStayAvailableForQuantity,
    validateRoomQuantityUpdate,
    computeNights,
    formatDateKey,
    toDateOnly
};
