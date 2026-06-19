const CURRENCY_SYMBOLS = {
    GHS: 'GH₵',
    USD: '$',
    EUR: '€',
    GBP: '£'
};

const LEGACY_CURRENCY_ALIASES = {
    GHC: 'GHS'
};

const normalizeCurrencyCode = (code, fallback = 'GHS') => {
    const raw =
        code != null && String(code).trim()
            ? String(code).trim().toUpperCase()
            : fallback;
    return LEGACY_CURRENCY_ALIASES[raw] || raw;
};

const getCurrencySymbol = (code) => {
    const currency = normalizeCurrencyCode(code);
    return CURRENCY_SYMBOLS[currency] || currency;
};

const getCurrencyDisplayPrefix = (code) => {
    const currency = normalizeCurrencyCode(code);
    if (currency === 'USD') return 'USD $';
    if (currency === 'GHS') return 'GHS ₵';
    return `${currency} `;
};

const formatPricePerNight = (price, currencyCode) => {
    const symbol = getCurrencySymbol(currencyCode);
    const amount = Number(price) || 0;
    return `${symbol} ${amount.toFixed(2)}/night`;
};

module.exports = {
    CURRENCY_SYMBOLS,
    normalizeCurrencyCode,
    getCurrencySymbol,
    getCurrencyDisplayPrefix,
    formatPricePerNight
};
