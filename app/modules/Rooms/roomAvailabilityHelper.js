const Booking = require('../Booking/bookingModel');

/** Only paid, confirmed stays block room availability on the website. */
const BLOCKING_STATUSES = ['Confirmed', 'Checked-In', 'Checked-Out'];
const BLOCKING_PAYMENT_STATUSES = ['paid'];

const roomBlockingBookingQuery = (roomId) => {
    const query = {
        isDeleted: false,
        status: { $in: BLOCKING_STATUSES },
        paymentStatus: { $in: BLOCKING_PAYMENT_STATUSES },
        checkInDate: { $exists: true, $ne: null },
        checkOutDate: { $exists: true, $ne: null }
    };
    if (roomId) {
        query.roomId = roomId;
    }
    return query;
};

const BLOCKING_BOOKING_SELECT =
    'roomId roomQuantity bookingReference checkInDate checkOutDate status paymentStatus adults children';
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

/** Only rooms with quantity > 1 need quantity in cart / booking requests. */
const isMultiQuantityRoom = (room) => {
    const quantity = parseInt(room?.quantity, 10);
    return Number.isFinite(quantity) && quantity > 1;
};

const resolveBookingQuantity = (room, { quantity, quantityProvided }) => {
    if (!isMultiQuantityRoom(room)) {
        return { quantity: 1, quantityProvided: false, invalidQuantity: false };
    }
    if (quantityProvided && (quantity == null || quantity < 1)) {
        return { quantity: null, quantityProvided: true, invalidQuantity: true };
    }
    return {
        quantity: quantityProvided ? quantity : 1,
        quantityProvided,
        invalidQuantity: false
    };
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

const getAllRoomBlockingBookings = async (roomId) =>
    Booking.find(roomBlockingBookingQuery(roomId))
        .select(BLOCKING_BOOKING_SELECT)
        .sort({ checkInDate: 1 })
        .lean();

const getRoomBlockingBookingsByRoomIds = async (roomIds = []) => {
    if (!roomIds.length) return [];
    return Booking.find({
        ...roomBlockingBookingQuery(),
        roomId: { $in: roomIds }
    })
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

        return {
            _id: block._id,
            startDate: block.startDate,
            endDate: block.endDate,
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

const buildFullRoomAvailability = (room, bookings) => {
    const quantity = getRoomQuantity(room);
    const bookingCountByDate = buildBookingCountByDate(bookings);

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
    const { blocked, blockedDates: adminBlockedDates } = getRoomBlockedDateData(room.blockedDates || []);
    const blockedDateSet = new Set(adminBlockedDates);

    const fullyBookedDates = [];
    const partiallyBookedDates = [];
    const occupancyByDate = {};

    bookingCountByDate.forEach((bookedCount, dateKey) => {
        const blocked = blockedDateSet.has(dateKey);
        const availableUnits = blocked ? 0 : Math.max(quantity - bookedCount, 0);
        occupancyByDate[dateKey] = {
            bookedCount,
            availableUnits,
            quantity,
            blocked
        };
        if (blocked || bookedCount >= quantity) {
            fullyBookedDates.push(dateKey);
        } else if (bookedCount > 0) {
            partiallyBookedDates.push(dateKey);
        }
    });

    blockedDateSet.forEach((dateKey) => {
        if (!occupancyByDate[dateKey]) {
            occupancyByDate[dateKey] = {
                bookedCount: bookingCountByDate.get(dateKey) || 0,
                availableUnits: 0,
                quantity,
                blocked: true
            };
        }
        if (!fullyBookedDates.includes(dateKey)) {
            fullyBookedDates.push(dateKey);
        }
    });

    fullyBookedDates.sort();
    partiallyBookedDates.sort();

    const unavailableDateSet = new Set(fullyBookedDates);
    const bookedDates = [...unavailableDateSet].sort();

    const today = toDateOnly(new Date());
    const windowEnd = getAvailableWindowEnd(bookings, room.blockedDates, today);
    const futureDateKeys = today <= windowEnd ? enumerateDateKeys(today, windowEnd) : [];
    const availableDates = futureDateKeys.filter((dateKey) => {
        if (blockedDateSet.has(dateKey)) return false;
        const bookedCount = bookingCountByDate.get(dateKey) || 0;
        return bookedCount < quantity;
    });

    futureDateKeys.forEach((dateKey) => {
        if (!occupancyByDate[dateKey]) {
            occupancyByDate[dateKey] = {
                bookedCount: bookingCountByDate.get(dateKey) || 0,
                availableUnits: blockedDateSet.has(dateKey)
                    ? 0
                    : Math.max(quantity - (bookingCountByDate.get(dateKey) || 0), 0),
                quantity,
                blocked: blockedDateSet.has(dateKey)
            };
        }
    });

    return {
        room: {
            _id: room._id,
            title: room.title,
            slug: room.slug,
            type: room.type,
            quantity
        },
        booked,
        blocked,
        bookingBookedDates,
        blockedDates: adminBlockedDates,
        bookedDates,
        partiallyBookedDates,
        availableDates,
        occupancyByDate,
        availableFrom: formatDateKey(today),
        availableUntil: formatDateKey(windowEnd),
        summary: {
            totalBookings: booked.length,
            totalBlockedRanges: blocked.length,
            totalBookingDays: bookingBookedDates.length,
            totalBlockedDays: adminBlockedDates.length,
            totalUnavailableDays: bookedDates.length,
            totalPartiallyBookedDays: partiallyBookedDates.length,
            totalAvailableDays: availableDates.length,
            quantity
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
    `${getRoomDisplayName(room)} not available for selected dates`;

const formatRoomQuantityUnavailable = (room, availableUnits) =>
    `${getRoomDisplayName(room)} - only ${availableUnits} unit(s) available for selected dates`;

const getStayQuantityStatus = (room, bookings, checkInDate, checkOutDate, requestedQuantity = 1) => {
    const quantity = getRoomQuantity(room);
    const bookingCountByDate = buildBookingCountByDate(bookings);
    const { blockedDates: adminBlockedDates } = getRoomBlockedDateData(room.blockedDates || []);
    const blockedDateSet = new Set(adminBlockedDates);
    const stayDates = getOccupiedDateKeysForBooking(checkInDate, checkOutDate);

    if (!stayDates.length) {
        return {
            quantity,
            availableUnits: quantity,
            bookedUnits: 0,
            available: true,
            reason: null,
            dateKey: null
        };
    }

    let maxBookedCount = 0;
    let minAvailableUnits = quantity;

    for (const dateKey of stayDates) {
        if (blockedDateSet.has(dateKey)) {
            const bookedCount = bookingCountByDate.get(dateKey) || 0;
            return {
                quantity,
                availableUnits: 0,
                bookedUnits: bookedCount,
                available: false,
                reason: formatRoomNotAvailableForDates(room),
                dateKey
            };
        }

        const bookedCount = bookingCountByDate.get(dateKey) || 0;
        maxBookedCount = Math.max(maxBookedCount, bookedCount);
        minAvailableUnits = Math.min(minAvailableUnits, Math.max(quantity - bookedCount, 0));

        if (bookedCount >= quantity) {
            return {
                quantity,
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
            quantity,
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
        quantity,
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
    getRoomDisplayName,
    formatRoomNotAvailableForDates,
    formatRoomQuantityUnavailable,
    getAllRoomBlockingBookings,
    getRoomBlockingBookingsByRoomIds,
    roomBlockingBookingQuery,
    buildFullRoomAvailability,
    getOccupiedDateKeysForBooking,
    getOccupiedDateKeysForRange,
    getRoomBlockedDateData,
    buildBookingCountByDate,
    getBookingUnitCount,
    getRoomQuantity,
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
