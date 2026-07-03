const DEFAULT_TZ = 'Africa/Accra';

const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const { resolveClientTimezone } = require('../../helper/clientTimezoneHelper');

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
    resolveRoomPriceForDay,
    shapeRateMeta
};
