const geoip = require('geoip-lite');

const DEFAULT_TZ = 'Africa/Accra';

const COUNTRY_PRIMARY_TZ = {
    GH: 'Africa/Accra',
    IN: 'Asia/Kolkata',
    NG: 'Africa/Lagos',
    GB: 'Europe/London',
    DE: 'Europe/Berlin',
    FR: 'Europe/Paris',
    AE: 'Asia/Dubai',
    SA: 'Asia/Riyadh',
    ZA: 'Africa/Johannesburg',
    KE: 'Africa/Nairobi',
    CA: 'America/Toronto',
    AU: 'Australia/Sydney'
};

const isValidTimezone = (timezone) => {
    if (!timezone || !String(timezone).trim()) return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: String(timezone).trim() });
        return true;
    } catch {
        return false;
    }
};

const normalizeTimezone = (timezone) => {
    const candidate = timezone != null ? String(timezone).trim() : '';
    return isValidTimezone(candidate) ? candidate : null;
};

const normalizeIp = (ip) => {
    if (!ip) return '';
    let value = String(ip).trim();
    if (value.startsWith('::ffff:')) value = value.slice(7);
    if (value.includes(':') && value.includes('.')) {
        const last = value.split(':').pop();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(last)) value = last;
    }
    return value;
};

const isPrivateIp = (ip) => {
    if (!ip || ip === '::1' || ip === '127.0.0.1') return true;
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    return false;
};

const getClientIp = (req) => {
    const forwarded = req?.headers?.['x-forwarded-for'];
    if (forwarded) {
        const first = String(forwarded).split(',')[0].trim();
        if (first) return normalizeIp(first);
    }

    return normalizeIp(
        req?.headers?.['x-real-ip'] ||
            req?.headers?.['cf-connecting-ip'] ||
            req?.ip ||
            req?.socket?.remoteAddress ||
            ''
    );
};

const timezoneFromIp = (ip) => {
    if (!ip || isPrivateIp(ip)) return null;

    const lookup = geoip.lookup(ip);
    if (lookup?.timezone) {
        return normalizeTimezone(lookup.timezone);
    }

    return null;
};

const timezoneFromCountryHeader = (req) => {
    const country = req?.headers?.['cf-ipcountry'] || req?.headers?.['x-country-code'];
    if (!country) return null;

    const code = String(country).trim().toUpperCase();
    if (!code || code === 'XX' || code === 'T1') return null;

    return normalizeTimezone(COUNTRY_PRIMARY_TZ[code]);
};

const timezoneFromExplicitClient = (req) => {
    const fromQuery = req?.query?.tz || req?.query?.timezone;
    const fromHeader =
        req?.headers?.['x-timezone'] ||
        req?.headers?.['x-client-timezone'] ||
        req?.headers?.timezone;

    return normalizeTimezone(fromQuery || fromHeader);
};

const resolveClientTimezone = (req) => {
    const explicit = timezoneFromExplicitClient(req);
    if (explicit) {
        return { tz: explicit, tzSource: 'client' };
    }

    const ip = getClientIp(req);
    const fromIp = timezoneFromIp(ip);
    if (fromIp) {
        return { tz: fromIp, tzSource: 'ip', ip };
    }

    const fromCountry = timezoneFromCountryHeader(req);
    if (fromCountry) {
        return { tz: fromCountry, tzSource: 'country', ip };
    }

    return { tz: DEFAULT_TZ, tzSource: 'default', ip };
};

module.exports = {
    DEFAULT_TZ,
    isValidTimezone,
    normalizeTimezone,
    getClientIp,
    resolveClientTimezone
};
