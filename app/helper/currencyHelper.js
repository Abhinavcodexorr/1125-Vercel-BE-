const CURRENCY_SYMBOLS = {
    GHS: 'GHS',
    USD: '$',
    EUR: '€',
    GBP: '£'
};

const LEGACY_CURRENCY_ALIASES = {
    GHC: 'GHS',
    CEDI: 'GHS'
};

const LEGACY_CURRENCY_SYMBOLS = ['GH₵', '₵'];

const normalizeCurrencyCode = (code, fallback = 'GHS') => {
    if (code == null || !String(code).trim()) return fallback;

    const trimmed = String(code).trim();
    const upper = trimmed.toUpperCase();

    if (LEGACY_CURRENCY_ALIASES[upper]) return LEGACY_CURRENCY_ALIASES[upper];
    if (LEGACY_CURRENCY_SYMBOLS.includes(trimmed)) return 'GHS';

    for (const [currencyCode, symbol] of Object.entries(CURRENCY_SYMBOLS)) {
        if (trimmed === symbol || upper === symbol) return currencyCode;
    }

    return upper;
};

const getCurrencySymbol = (code) => {
    const currency = normalizeCurrencyCode(code);
    return CURRENCY_SYMBOLS[currency] || currency;
};

const getCurrencyDisplayPrefix = (code) => {
    const currency = normalizeCurrencyCode(code);
    if (currency === 'USD') return 'USD $';
    if (currency === 'GHS') return 'GHS ';
    return `${currency} `;
};

const formatPricePerNight = (price, currencyCode) => {
    const symbol = getCurrencySymbol(currencyCode);
    const amount = Number(price) || 0;
    return `${symbol} ${amount.toFixed(2)}/night`;
};

const shapeMoneyFields = (price, currencyCode) => {
    const currency = normalizeCurrencyCode(currencyCode);
    const currencySymbol = getCurrencySymbol(currency);

    return {
        currency,
        currencySymbol,
        formattedPrice: `${currencySymbol} ${(Number(price) || 0).toFixed(2)}/night`
    };
};

const normalizeRoomDocCurrency = (doc) => {
    if (!doc?.currency) return doc;
    doc.currency = normalizeCurrencyCode(doc.currency);
    return doc;
};

const normalizeBookingCurrencyFields = (doc) => {
    if (!doc) return doc;
    if (doc.currency) doc.currency = normalizeCurrencyCode(doc.currency);
    if (doc.roomSnapshot?.currency) {
        doc.roomSnapshot.currency = normalizeCurrencyCode(doc.roomSnapshot.currency);
    }
    if (Array.isArray(doc.package)) {
        doc.package.forEach((pkg) => {
            if (pkg?.currency) pkg.currency = normalizeCurrencyCode(pkg.currency);
        });
    }
    if (Array.isArray(doc.cabins)) {
        doc.cabins.forEach((cabin) => {
            if (cabin?.currency) cabin.currency = normalizeCurrencyCode(cabin.currency);
            if (Array.isArray(cabin?.packages)) {
                cabin.packages.forEach((pkg) => {
                    if (pkg?.currency) pkg.currency = normalizeCurrencyCode(pkg.currency);
                });
            }
        });
    }
    if (Array.isArray(doc.activities)) {
        doc.activities.forEach((act) => {
            if (act?.currency) act.currency = normalizeCurrencyCode(act.currency);
        });
    }
    return doc;
};

const normalizeCartCurrencyFields = (doc) => {
    if (!doc) return doc;
    if (doc.currency) doc.currency = normalizeCurrencyCode(doc.currency);
    if (Array.isArray(doc.items)) {
        doc.items.forEach((item) => {
            if (item?.currency) item.currency = normalizeCurrencyCode(item.currency);
            if (item?.roomSnapshot?.currency) {
                item.roomSnapshot.currency = normalizeCurrencyCode(item.roomSnapshot.currency);
            }
        });
    }
    return doc;
};

module.exports = {
    CURRENCY_SYMBOLS,
    normalizeCurrencyCode,
    getCurrencySymbol,
    getCurrencyDisplayPrefix,
    formatPricePerNight,
    shapeMoneyFields,
    normalizeRoomDocCurrency,
    normalizeBookingCurrencyFields,
    normalizeCartCurrencyFields
};
