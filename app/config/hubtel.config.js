require('dotenv').config();

const stripEnv = (value) => {
    if (value == null) return '';
    return String(value)
        .replace(/^['"]|['"]$/g, '')
        .replace(/;+\s*$/g, '')
        .trim();
};

/** Public API base used for Hubtel callback / return URLs (no trailing slash). */
const resolveApiBaseUrl = () => {
    const explicit = stripEnv(process.env.API_PUBLIC_URL || process.env.BASE_URL);
    if (explicit) return explicit.replace(/\/api\/v1\/?$/i, '').replace(/\/$/, '');

    const port = stripEnv(process.env.PORT) || '3002';
    return `http://localhost:${port}`;
};

const joinApiPath = (segment) => {
    const apiPath = stripEnv(process.env.API_URL) || '/api/v1/';
    const normalized = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return `${resolveApiBaseUrl()}${withSlash}${segment.replace(/^\//, '')}`;
};

/** Hardcoded Hubtel URLs — do not rely on Render/Vercel env (bad values caused 404 on initiate). */
const HUBTEL_INITIATE_URL = 'https://payproxyapi.hubtel.com/items/initiate';
const HUBTEL_STATUS_URL_BASE = 'https://api-txnstatus.hubtel.com/transactions';
const HUBTEL_CALLBACK_URL =
    'https://one125-vercel-be-g0yd.onrender.com/api/v1/booking/hubtel/callback';
const HUBTEL_RETURN_URL = 'http://localhost:3001/thank-you';
const HUBTEL_CANCELLATION_URL = 'https://1125-beach-zeta.vercel.app/';

const getHubtelSettings = () => {
    const apiId = stripEnv(process.env.HUBTEL_API_ID || process.env.HUBTEL_CLIENT_ID);
    const apiKey = stripEnv(process.env.HUBTEL_API_KEY || process.env.HUBTEL_CLIENT_SECRET);
    const merchantAccountNumber = stripEnv(
        process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER || process.env.HUBTEL_MERCHANT_ACCOUNT
    );

    const callbackUrl = HUBTEL_CALLBACK_URL;
    const returnUrl = HUBTEL_RETURN_URL;
    const cancellationUrl = HUBTEL_CANCELLATION_URL;
    const initiateUrl = HUBTEL_INITIATE_URL;
    const statusUrlBase = HUBTEL_STATUS_URL_BASE;

    return {
        apiId,
        apiKey,
        merchantAccountNumber,
        callbackUrl,
        returnUrl,
        cancellationUrl,
        initiateUrl,
        statusUrlBase
    };
};

const getHubtelConfigErrors = (config) => {
    const missing = [];
    if (!config.apiId) missing.push('HUBTEL_API_ID');
    if (!config.apiKey) missing.push('HUBTEL_API_KEY');
    if (!config.merchantAccountNumber) missing.push('HUBTEL_MERCHANT_ACCOUNT_NUMBER');
    if (!config.callbackUrl) missing.push('HUBTEL_CALLBACK_URL');
    if (!config.returnUrl) missing.push('HUBTEL_RETURN_URL');
    return missing;
};

module.exports = {
    resolveApiBaseUrl,
    getHubtelSettings,
    getHubtelConfigErrors
};
