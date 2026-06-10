const axios = require('axios');
const appConfig = require('../../config/app.config');

const getHubtelConfig = () => {
    const apiId = (process.env.HUBTEL_API_ID || process.env.HUBTEL_CLIENT_ID || '').trim();
    const apiKey = (process.env.HUBTEL_API_KEY || process.env.HUBTEL_CLIENT_SECRET || '').trim();
    const merchantAccountNumber = (
        process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER ||
        process.env.HUBTEL_MERCHANT_ACCOUNT ||
        ''
    ).trim();
    const callbackUrl = (
        process.env.HUBTEL_CALLBACK_URL || appConfig.joinApi('booking/hubtel/callback')
    ).trim();
    const returnUrl = (process.env.HUBTEL_RETURN_URL || appConfig.joinApi('booking/confirm')).trim();
    const cancellationUrl = (process.env.HUBTEL_CANCELLATION_URL || returnUrl).trim();
    const initiateUrl =
        (process.env.HUBTEL_INITIATE_URL || 'https://payproxyapi.hubtel.com/items/initiate').trim();
    const statusUrlBase =
        (process.env.HUBTEL_STATUS_URL || 'https://api.hubtel.com/v2/pos/onlinecheckout').trim();

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

const getAuthHeader = () => {
    const { apiId, apiKey } = getHubtelConfig();
    if (!apiId || !apiKey) {
        throw new Error('Hubtel credentials are not configured');
    }
    return `Basic ${Buffer.from(`${apiId}:${apiKey}`).toString('base64')}`;
};

const initiateCheckout = async ({
    totalAmount,
    description,
    clientReference,
    customerPhoneNumber
}) => {
    const config = getHubtelConfig();
    if (!config.merchantAccountNumber || !config.callbackUrl || !config.returnUrl) {
        throw new Error('Hubtel merchant account, callback URL, and return URL must be configured');
    }

    const payload = {
        totalAmount: Number(Number(totalAmount).toFixed(2)),
        description: description || '1125 room booking',
        callbackUrl: config.callbackUrl,
        returnUrl: config.returnUrl,
        cancellationUrl: config.cancellationUrl,
        merchantAccountNumber: config.merchantAccountNumber,
        clientReference
    };

    if (customerPhoneNumber) {
        payload.customerPhoneNumber = String(customerPhoneNumber).replace(/\s+/g, '');
    }

    const response = await axios.post(config.initiateUrl, payload, {
        headers: {
            Authorization: getAuthHeader(),
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });

    const data = response.data?.data || response.data;
    const checkoutUrl =
        data?.checkoutUrl ||
        data?.checkoutDirectUrl ||
        data?.authorizationUrl ||
        response.data?.checkoutUrl ||
        null;

    if (!checkoutUrl) {
        throw new Error('Hubtel did not return a checkout URL');
    }

    return {
        checkoutUrl,
        raw: response.data
    };
};

const verifyTransaction = async (clientReference) => {
    const config = getHubtelConfig();
    const url = `${config.statusUrlBase}/${encodeURIComponent(clientReference)}/status`;

    const response = await axios.get(url, {
        headers: {
            Authorization: getAuthHeader()
        },
        timeout: 30000
    });

    const payload = response.data?.data || response.data || {};
    const status = String(payload.status || payload.Status || '').toLowerCase();

    return {
        isPaid: status === 'paid' || status === 'success',
        status: payload.status || payload.Status || 'unknown',
        raw: response.data
    };
};

const isPaidCallback = (body = {}) => {
    const status = String(body.Status || body.status || '').toLowerCase();
    return status === 'paid' || status === 'success';
};

module.exports = {
    getHubtelConfig,
    initiateCheckout,
    verifyTransaction,
    isPaidCallback
};
