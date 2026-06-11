require('../loadEnv');

const stripEnv = (value) => {
    if (value == null) return '';
    return String(value).replace(/^['"]|['"]$/g, '').trim();
};

/** Public API base used for Hubtel callback / return URLs (no trailing slash). */
const resolveApiBaseUrl = () => {
    const explicit = stripEnv(process.env.API_PUBLIC_URL || process.env.BASE_URL);
    if (explicit) return explicit.replace(/\/api\/v1\/?$/i, '').replace(/\/$/, '');

    const render = stripEnv(process.env.RENDER_EXTERNAL_URL);
    if (render) return render.replace(/\/$/, '');

    const vercel = stripEnv(process.env.VERCEL_URL);
    if (vercel) return `https://${vercel.replace(/^https?:\/\//, '')}`;

    const port = stripEnv(process.env.PORT) || '3002';
    return `http://localhost:${port}`;
};

const joinApiPath = (segment) => {
    const apiPath = stripEnv(process.env.API_URL) || '/api/v1/';
    const normalized = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return `${resolveApiBaseUrl()}${withSlash}${segment.replace(/^\//, '')}`;
};

const getHubtelSettings = () => {
    const apiId = stripEnv(process.env.HUBTEL_API_ID || process.env.HUBTEL_CLIENT_ID);
    const apiKey = stripEnv(process.env.HUBTEL_API_KEY || process.env.HUBTEL_CLIENT_SECRET);
    const merchantAccountNumber = stripEnv(
        process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER || process.env.HUBTEL_MERCHANT_ACCOUNT
    );

    const callbackUrl =
        stripEnv(process.env.HUBTEL_CALLBACK_URL) || joinApiPath('booking/hubtel/callback');
    const returnUrl = stripEnv(process.env.HUBTEL_RETURN_URL) || joinApiPath('booking/confirm');
    const cancellationUrl =
        stripEnv(process.env.HUBTEL_CANCELLATION_URL) || returnUrl;

    const initiateUrl =
        stripEnv(process.env.HUBTEL_INITIATE_URL) || 'https://payproxyapi.hubtel.com/items/initiate';
    const statusUrlBase =
        stripEnv(process.env.HUBTEL_STATUS_URL) ||
        'https://api-txnstatus.hubtel.com/transactions';

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
