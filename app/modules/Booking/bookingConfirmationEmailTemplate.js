const { getCurrencyDisplayPrefix } = require('../../helper/currencyHelper');

const BOOKING_CONFIRMATION_SUBJECT = 'Booking Confirmation';
const BOOKING_CONFIRMATION_VILLA_RECIPIENT = 'info@1125beachvilla.com';
const BOOKING_CONFIRMATION_CONTACT_EMAIL = 'info@1125beachvilla.com';
const BRAND_COLOR = '#5a8aad';
const BRAND_COLOR_LIGHT = '#eef4f8';
const BRAND_COLOR_DARK = '#4a7596';

const escapeHtml = (value) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const formatBookingDate = (date, suffix = '') => {
    if (!date) return 'N/A';
    const formatted = new Date(date).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    return suffix ? `${formatted} · ${suffix}` : formatted;
};

const formatGuests = (adults = 0, children = 0) => {
    const adultCount = Number(adults) || 0;
    const childCount = Number(children) || 0;
    const parts = [`${adultCount} adult${adultCount !== 1 ? 's' : ''}`];
    if (childCount > 0) {
        parts.push(`${childCount} child${childCount !== 1 ? 'ren' : ''}`);
    }
    return parts.join(', ');
};

const formatAmount = (amount, currency) => {
    const prefix = getCurrencyDisplayPrefix(currency);
    const value = Number(amount);
    const formatted = Number.isFinite(value)
        ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '0.00';
    return `${prefix}${formatted}`;
};

const buildBookingConfirmationSubject = (bookingReference) =>
    bookingReference
        ? `${BOOKING_CONFIRMATION_SUBJECT} - Reference: ${bookingReference}`
        : BOOKING_CONFIRMATION_SUBJECT;

const buildBookingConfirmationEmailHtml = ({ booking, roomName }) => {
    const guest = booking?.guestDetails || {};
    const guestName = `${guest.firstName || ''} ${guest.lastName || ''}`.trim() || 'Guest';
    const bookingReference = booking?.bookingReference || 'N/A';
    const checkIn = formatBookingDate(booking?.checkInDate, 'after 2:00 PM');
    const checkOut = formatBookingDate(booking?.checkOutDate, 'before 11:00 AM');
    const guests = formatGuests(booking?.adults, booking?.children);
    const amountPaid = formatAmount(booking?.totalAmount, booking?.currency);
    const room =
        roomName ||
        booking?.roomSnapshot?.title ||
        booking?.cabinId?.name ||
        booking?.cabins?.[0]?.cabinName ||
        'Room';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${BOOKING_CONFIRMATION_SUBJECT}</title>
    <style>
        body, table, td, p, a {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
        }
        table, td {
            mso-table-lspace: 0;
            mso-table-rspace: 0;
            border-collapse: collapse;
        }
        body {
            margin: 0;
            padding: 0;
            width: 100% !important;
            background-color: #f4f6f8;
            font-family: Arial, Helvetica, sans-serif;
            color: #333333;
        }
        .email-wrapper {
            width: 100%;
            background-color: #f4f6f8;
            padding: 24px 12px;
        }
        .email-container {
            width: 100%;
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
        }
        .header {
            background-color: ${BRAND_COLOR};
            color: #ffffff;
            text-align: center;
            padding: 24px 20px;
        }
        .header-title {
            margin: 0;
            font-size: 22px;
            line-height: 1.3;
            font-weight: 700;
        }
        .content {
            padding: 24px 20px;
        }
        .intro-text {
            margin: 0 0 20px;
            font-size: 15px;
            line-height: 1.7;
            color: #333333;
        }
        .section-title {
            margin: 0 0 12px 0;
            font-size: 13px;
            font-weight: 700;
            color: ${BRAND_COLOR};
            text-transform: uppercase;
            letter-spacing: 0.6px;
        }
        .details-box {
            background-color: ${BRAND_COLOR_LIGHT};
            border: 1px solid ${BRAND_COLOR};
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 20px;
        }
        .detail-label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            color: ${BRAND_COLOR_DARK};
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        .detail-value {
            display: block;
            font-size: 15px;
            line-height: 1.5;
            color: #333333;
            margin-bottom: 14px;
            word-break: break-word;
        }
        .detail-value:last-child {
            margin-bottom: 0;
        }
        .detail-value.highlight {
            font-weight: 700;
            color: ${BRAND_COLOR};
        }
        .note-box {
            border: 1px solid #d9e2ea;
            border-left: 4px solid ${BRAND_COLOR};
            border-radius: 6px;
            padding: 16px;
            background-color: #ffffff;
        }
        .note-content {
            margin: 0;
            font-size: 14px;
            line-height: 1.7;
            color: #555555;
        }
        .note-content a {
            color: ${BRAND_COLOR};
            text-decoration: none;
            font-weight: 600;
        }
        .footer {
            background-color: #fafbfc;
            border-top: 1px solid #e5ebf0;
            text-align: center;
            padding: 18px 20px;
        }
        .footer p {
            margin: 4px 0;
            font-size: 12px;
            line-height: 1.5;
            color: #666666;
        }
        .footer-brand {
            color: ${BRAND_COLOR};
            font-weight: 600;
        }
        @media only screen and (max-width: 620px) {
            .email-wrapper { padding: 12px 8px !important; }
            .header { padding: 20px 16px !important; }
            .header-title { font-size: 20px !important; }
            .content { padding: 20px 16px !important; }
            .details-box, .note-box { padding: 14px !important; }
            .detail-value, .intro-text, .note-content { font-size: 14px !important; }
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
                <td align="center">
                    <table role="presentation" class="email-container" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                            <td class="header">
                                <h1 class="header-title">Booking Confirmed</h1>
                            </td>
                        </tr>
                        <tr>
                            <td class="content">
                                <p class="intro-text">
                                    Hi <strong>${escapeHtml(guestName)}</strong>,<br><br>
                                    Thank you for booking with <strong>1125 Beach Villa</strong>. Your reservation is confirmed — we look forward to welcoming you.
                                </p>
                                <p class="section-title">Booking Details</p>
                                <div class="details-box">
                                    <span class="detail-label">Reference</span>
                                    <span class="detail-value highlight">${escapeHtml(bookingReference)}</span>
                                    <span class="detail-label">Check-in</span>
                                    <span class="detail-value">${escapeHtml(checkIn)}</span>
                                    <span class="detail-label">Check-out</span>
                                    <span class="detail-value">${escapeHtml(checkOut)}</span>
                                    <span class="detail-label">Room</span>
                                    <span class="detail-value">${escapeHtml(room)}</span>
                                    <span class="detail-label">Guests</span>
                                    <span class="detail-value">${escapeHtml(guests)}</span>
                                    <span class="detail-label">Amount Paid</span>
                                    <span class="detail-value highlight">${escapeHtml(amountPaid)}</span>
                                </div>
                                <div class="note-box">
                                    <p class="note-content">
                                        If you have any questions about your stay, please contact us at
                                        <a href="mailto:${BOOKING_CONFIRMATION_CONTACT_EMAIL}">${BOOKING_CONFIRMATION_CONTACT_EMAIL}</a>.
                                    </p>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td class="footer">
                                <p class="footer-brand">1125 Beach Villa</p>
                                <p>This is an automated booking confirmation email.</p>
                                <p>&copy; ${new Date().getFullYear()} 1125 Beach Villa. All rights reserved.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </div>
</body>
</html>`;
};

const getConfirmationVillaRecipient = () => BOOKING_CONFIRMATION_VILLA_RECIPIENT;

module.exports = {
    BOOKING_CONFIRMATION_SUBJECT,
    BOOKING_CONFIRMATION_VILLA_RECIPIENT,
    buildBookingConfirmationSubject,
    buildBookingConfirmationEmailHtml,
    getConfirmationVillaRecipient
};
