const DEFAULT_TZ = 'Africa/Accra';

const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const { resolveClientTimezone } = require('../../helper/clientTimezoneHelper');
const { toDateOnly, formatDateKey } = require('./roomAvailabilityHelper');

const resolveRequestTimezone = (req) => resolveClientTimezone(req);

const parseClientTimezone = (req) => resolveRequestTimezone(req).tz;

const getWeekdayIndex = (timezone = DEFAULT_TZ, date = new Date()) => {
    const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short'
    }).format(date);
    return WEEKDAY_MAP[weekday] ?? 0;
};

const getLocalDayName = (timezone = DEFAULT_TZ, date = new Date()) =>
    new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long'
    }).format(date);

const isWeekend = (timezone = DEFAULT_TZ, date = new Date()) => {
    const day = getWeekdayIndex(timezone, date);
    return day === 0 || day === 6;
};

const getRoomWdPrice = (room) =>
    room.weekdayPrice != null ? Number(room.weekdayPrice) : Number(room.price) || 0;

const getRoomWePrice = (room) =>
    room.weekendPrice != null ? Number(room.weekendPrice) : Number(room.price) || 0;

const isCalendarWeekend = (date) => {
    const day = date.getDay();
    return day === 0 || day === 6;
};

const getRateForNight = (room, date) => {
    const weekend = isCalendarWeekend(date);
    return {
        rate: weekend ? getRoomWePrice(room) : getRoomWdPrice(room),
        dayType: weekend ? 'we' : 'wd'
    };
};

const enumerateStayNights = (checkInDate, checkOutDate) => {
    const checkIn = toDateOnly(checkInDate);
    const checkOut = toDateOnly(checkOutDate);
    if (!checkIn || !checkOut || checkOut <= checkIn) return [];

    const nights = [];
    const cursor = new Date(checkIn);
    const lastNight = new Date(checkOut);
    lastNight.setDate(lastNight.getDate() - 1);

    while (cursor <= lastNight) {
        nights.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return nights;
};

const computeStayPricing = (room, checkInDate, checkOutDate, quantity = 1) => {
    const nightDates = enumerateStayNights(checkInDate, checkOutDate);
    const nightBreakdown = nightDates.map((date) => {
        const { rate, dayType } = getRateForNight(room, date);
        return {
            date: formatDateKey(date),
            day: DAY_NAMES[date.getDay()],
            dayType,
            rate
        };
    });

    let wdNights = 0;
    let weNights = 0;
    let nightlyTotal = 0;

    nightBreakdown.forEach((night) => {
        nightlyTotal += night.rate;
        if (night.dayType === 'we') weNights += 1;
        else wdNights += 1;
    });

    const nights = nightBreakdown.length;
    const subTotal = Number((nightlyTotal * quantity).toFixed(2));
    const avgPricePerNight = nights > 0 ? Number((nightlyTotal / nights).toFixed(2)) : 0;

    return {
        nights,
        wdNights,
        weNights,
        wdPrice: getRoomWdPrice(room),
        wePrice: getRoomWePrice(room),
        nightBreakdown,
        nightlyTotal: Number(nightlyTotal.toFixed(2)),
        avgPricePerNight,
        subTotal
    };
};

const resolveRoomPriceForDay = (room, timezone = DEFAULT_TZ, date = new Date()) => {
    const weekend = isWeekend(timezone, date);
    const amount = weekend ? getRoomWePrice(room) : getRoomWdPrice(room);

    return {
        amount,
        dayType: weekend ? 'we' : 'wd',
        localDay: getLocalDayName(timezone, date),
        tz: timezone
    };
};

const shapeRateMeta = (timezone = DEFAULT_TZ, date = new Date(), context = {}) => {
    const weekend = isWeekend(timezone, date);
    return {
        tz: timezone,
        tzSource: context.tzSource || 'default',
        localDay: getLocalDayName(timezone, date),
        dayType: weekend ? 'we' : 'wd'
    };
};

module.exports = {
    DEFAULT_TZ,
    resolveRequestTimezone,
    parseClientTimezone,
    getWeekdayIndex,
    getLocalDayName,
    isWeekend,
    getRoomWdPrice,
    getRoomWePrice,
    computeStayPricing,
    resolveRoomPriceForDay,
    shapeRateMeta
};
