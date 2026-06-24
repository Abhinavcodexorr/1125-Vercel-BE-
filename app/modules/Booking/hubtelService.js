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

const normalizeHubtelStatus = (value) => String(value || '').toLowerCase();

const isPaidStatus = (value) => {
    const status = normalizeHubtelStatus(value);
    return status === 'paid' || status === 'success';
};

const isFailedStatus = (value) => {
    const status = normalizeHubtelStatus(value);
    return status === 'failed' || status === 'declined' || status === 'refunded';
};

const extractHubtelStatusFromPayload = (payload = {}) => {
    const direct = payload.Status || payload.status;
    if (direct) return String(direct);

    const data = payload.data || payload.Data || {};
    return data.status || data.Status || payload.responseCode || null;
};

const resolveStatusFromPaymentResponse = (paymentResponse) => {
    if (!paymentResponse || typeof paymentResponse !== 'object') {
        return null;
    }

    const fromCallback = extractHubtelStatusFromPayload(paymentResponse);
    if (fromCallback) {
        return {
            isPaid: isPaidStatus(fromCallback),
            isFailed: isFailedStatus(fromCallback),
            status: String(fromCallback)
        };
    }

    const nested = paymentResponse.data || paymentResponse.Data;
    if (nested && typeof nested === 'object') {
        const nestedStatus = extractHubtelStatusFromPayload(nested);
        if (nestedStatus) {
            return {
                isPaid: isPaidStatus(nestedStatus),
                isFailed: isFailedStatus(nestedStatus),
                status: String(nestedStatus)
            };
        }
    }

    return null;
};

const resolveStatusFromBooking = (booking) => {
    if (!booking) return null;

    if (booking.paymentStatus === 'paid') {
        return { isPaid: true, isFailed: false, status: 'Paid', source: 'database' };
    }
    if (booking.paymentStatus === 'failed') {
        return { isPaid: false, isFailed: true, status: 'Failed', source: 'database' };
    }

    const fromStored = resolveStatusFromPaymentResponse(booking.paymentResponse);
    if (fromStored) {
        return { ...fromStored, source: 'paymentResponse' };
    }

    if (booking.paymentStatus === 'pending') {
        return { isPaid: false, isFailed: false, status: 'Pending', source: 'database' };
    }

    return {
        isPaid: false,
        isFailed: false,
        status: booking.paymentStatus || 'unknown',
        source: 'database'
    };
};

const buildStatusCheckUrls = (config, clientReference, booking = null) => {
    const urls = [];
    const merchant = config.merchantAccountNumber;
    const paymentResponse = booking?.paymentResponse || {};
    const initiateData = paymentResponse.data || paymentResponse.Data || paymentResponse;
    const checkoutId =
        initiateData.checkoutId ||
        initiateData.CheckoutId ||
        booking?.transactionId ||
        null;

    urls.push(`${config.statusUrlBase}/${encodeURIComponent(clientReference)}/status`);

    if (merchant) {
        urls.push(
            `${config.statusUrlBase}/${encodeURIComponent(merchant)}/status?clientReference=${encodeURIComponent(clientReference)}`,
            `https://api.hubtel.com/v1/merchantaccount/merchants/${encodeURIComponent(merchant)}/transactions/status?clientReference=${encodeURIComponent(clientReference)}`
        );
    }

    if (checkoutId) {
        urls.push(
            `${config.statusUrlBase}/${encodeURIComponent(checkoutId)}/status`,
            `https://api.hubtel.com/v1/merchantaccount/merchants/${encodeURIComponent(merchant)}/transactions/status?hubtelTransactionId=${encodeURIComponent(checkoutId)}`
        );
    }

    return [...new Set(urls.filter(Boolean))];
};

const parseStatusApiResponse = (responseData) => {
    const payload = responseData?.data || responseData || {};
    const status = extractHubtelStatusFromPayload(payload) || extractHubtelStatusFromPayload(responseData);

    return {
        isPaid: isPaidStatus(status),
        isFailed: isFailedStatus(status),
        status: status ? String(status) : 'unknown',
        raw: responseData,
        source: 'hubtel-api'
    };
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

    try {
        const response = await axios.post(config.initiateUrl, payload, {
            headers: {
                Authorization: getAuthHeader(),
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const data = response.data?.data || response.data;
        const responseCode = String(response.data?.responseCode || data?.responseCode || '');
        const hubtelStatus = normalizeHubtelStatus(response.data?.status || data?.status);

        if (responseCode && responseCode !== '0000' && hubtelStatus !== 'success') {
            const hubtelMessage =
                response.data?.message ||
                data?.message ||
                response.data?.status ||
                'Hubtel checkout initiation failed';
            throw new Error(hubtelMessage);
        }

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
            checkoutId: data?.checkoutId || data?.CheckoutId || null,
            raw: response.data
        };
    } catch (error) {
        if (error.response?.data) {
            const body = error.response.data;
            const message =
                body.message ||
                body.Message ||
                body.status ||
                body.error ||
                JSON.stringify(body);
            throw new Error(`Hubtel payment error: ${message}`);
        }
        if (error.code === 'ENOTFOUND' || error.code === 'ERR_INVALID_URL') {
            throw new Error(
                `Hubtel payment error: invalid API URL (${config.initiateUrl}). Check HUBTEL_INITIATE_URL in .env`
            );
        }
        throw error;
    }
};

const verifyTransaction = async (clientReference, booking = null) => {
    const config = getHubtelConfig();
    const urls = buildStatusCheckUrls(config, clientReference, booking);
    const headers = {
        Authorization: getAuthHeader(),
        Accept: 'application/json'
    };

    let lastError = null;

    for (const url of urls) {
        try {
            const response = await axios.get(url, {
                headers,
                timeout: 30000,
                validateStatus: (status) => status < 500
            });

            if (response.status === 401 || response.status === 403) {
                lastError = new Error(
                    `Hubtel status API unauthorized (${response.status}). Check HUBTEL_API_ID and HUBTEL_API_KEY on the server.`
                );
                continue;
            }

            if (response.status >= 400) {
                lastError = new Error(`Hubtel status API returned HTTP ${response.status}`);
                continue;
            }

            return parseStatusApiResponse(response.data);
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error('Hubtel status check failed');
};

const isPaidCallback = (body = {}) => {
    return isPaidStatus(body.Status || body.status);
};

module.exports = {
    getHubtelConfig,
    initiateCheckout,
    verifyTransaction,
    isPaidCallback,
    resolveStatusFromBooking,
    resolveStatusFromPaymentResponse,
    isPaidStatus
};
