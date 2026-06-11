const axios = require('axios');
const { getHubtelSettings, getHubtelConfigErrors } = require('../../config/hubtel.config');

const getHubtelConfig = () => getHubtelSettings();

const getAuthHeader = () => {
    const { apiId, apiKey } = getHubtelConfig();
    if (!apiId || !apiKey) {
        throw new Error('Hubtel credentials are not configured (set HUBTEL_API_ID and HUBTEL_API_KEY)');
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
    const missing = getHubtelConfigErrors(config);
    if (missing.length) {
        throw new Error(`Hubtel configuration missing: ${missing.join(', ')}`);
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
