/**
 * Guest cancellation email (split bookings: one row = one cabin or one activity).
 * Text header only (no logo). Activity rows show ticket lines like cart confirmation.
 * Refund policy uses activity date or stay check-in (see getRefundPolicyAnchorDate), not createdAt.
 */
const sendEmail = require('../../middleware/mail');
const { getRefundPolicyAnchorDate } = require('../../helper/refundPolicyAnchor');
const { getCurrencyDisplayPrefix, normalizeCurrencyCode } = require('../../helper/currencyHelper');

function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function activityTicketLinesHtml(act) {
    const parts = [];
    if ((act.single || 0) > 0) parts.push(`Per Person x ${act.single}`);
    if ((act.couple || 0) > 0) parts.push(`2 Persons x ${act.couple}`);
    if ((act.groupOfFour || 0) > 0) parts.push(`Group of 4 x ${act.groupOfFour}`);
    if ((act.children || 0) > 0) parts.push(`Children x ${act.children}`);
    return parts.map((p) => escapeHtml(p)).join('<br>');
}

function formatGuestPhoneForEmail(guestDetails) {
    if (!guestDetails?.mobileNumber?.trim?.()) return '';
    const mobile = guestDetails.mobileNumber.trim();
    const cc = guestDetails.countryCode?.trim?.();
    if (cc) return `${cc} ${mobile}`;
    return mobile;
}

function formatDateLong(d) {
    const x = new Date(d);
    if (isNaN(x.getTime())) return '—';
    return x.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatActivityDate(d) {
    const x = new Date(d);
    if (isNaN(x.getTime())) return '—';
    return x.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function currencyPrefix(code) {
    return getCurrencyDisplayPrefix(code);
}

function fmtAmount(n, cur) {
    const num = Number(n);
    const v = Number.isFinite(num) ? num : 0;
    return `${currencyPrefix(cur)}${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtAmount2(n, cur) {
    const num = Number(n);
    const v = Number.isFinite(num) ? num : 0;
    return `${currencyPrefix(cur)}${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {Date} policyAnchorDate - activity or stay check-in (see getRefundPolicyAnchorDate)
 * @param {Date} cancelledAt
 * @param {boolean} isActivityBooking
 */
function buildRefundMessage(policyAnchorDate, cancelledAt, isActivityBooking) {
    if (!policyAnchorDate || !cancelledAt) {
        return 'Refund eligibility will be determined according to our cancellation policy.';
    }
    const anchor = new Date(policyAnchorDate);
    const can = new Date(cancelledAt);
    anchor.setHours(0, 0, 0, 0);
    can.setHours(0, 0, 0, 0);
    const daysDifference = Math.ceil((anchor - can) / (1000 * 60 * 60 * 24));

    const datePhrase = isActivityBooking ? 'scheduled activity date' : 'check-in date';

    if (daysDifference >= 7) {
        return `As your booking was cancelled 7 days or more before the ${datePhrase}, you are eligible for a full refund. Refunds are processed within 14 business days.`;
    }
    if (daysDifference >= 1 && daysDifference <= 6) {
        return `As your booking was cancelled between 1 and 6 days before the ${datePhrase}, you are eligible for a 50% refund. Refunds are processed within 14 business days.`;
    }
    const samePhrase = isActivityBooking
        ? 'on the activity date or thereafter'
        : 'on the check-in date';
    return `As your booking was cancelled ${samePhrase}, this cancellation is non-refundable in accordance with our cancellation policy.`;
}

function calculateRefundAmounts(policyAnchorDate, cancelledAt, totalAmount, isActivityBooking, paymentStatus, cancellationFee) {
    const paid = Number(totalAmount) || 0;
    if (paymentStatus !== 'paid' || paid <= 0) {
        return { totalPaid: paid, refundedAmount: 0 };
    }

    const fee = Number(cancellationFee) || 0;
    if (fee > 0) {
        return { totalPaid: paid, refundedAmount: Math.max(0, paid - fee) };
    }

    if (!policyAnchorDate || !cancelledAt) {
        return { totalPaid: paid, refundedAmount: 0 };
    }

    const anchor = new Date(policyAnchorDate);
    const can = new Date(cancelledAt);
    anchor.setHours(0, 0, 0, 0);
    can.setHours(0, 0, 0, 0);
    const daysDifference = Math.ceil((anchor - can) / (1000 * 60 * 60 * 24));

    if (daysDifference >= 7) {
        return { totalPaid: paid, refundedAmount: paid };
    }
    if (daysDifference >= 1 && daysDifference <= 6) {
        return { totalPaid: paid, refundedAmount: paid * 0.5 };
    }
    return { totalPaid: paid, refundedAmount: 0 };
}

function getRefundEligibilityLabel(policyAnchorDate, cancelledAt, isActivityBooking, paymentStatus) {
    if (paymentStatus !== 'paid') return 'Not applicable (booking not paid)';
    if (!policyAnchorDate || !cancelledAt) return 'Policy evaluation unavailable';

    const anchor = new Date(policyAnchorDate);
    const can = new Date(cancelledAt);
    anchor.setHours(0, 0, 0, 0);
    can.setHours(0, 0, 0, 0);
    const daysDifference = Math.ceil((anchor - can) / (1000 * 60 * 60 * 24));

    if (daysDifference >= 7) return '100% refund (Cancellation 7+ days before date)';
    if (daysDifference >= 1 && daysDifference <= 6) return '50% refund (Cancellation within 1–6 days)';
    if (isActivityBooking) return 'No refund (Cancellation on activity date or later)';
    return 'No refund (Cancellation on the same day)';
}

function detailRow(label, valueHtml) {
    return `
<tr>
<td class="detail-item" style="background-color:#f8f9fa;border-left:4px solid #133730;padding:12px 15px;margin-bottom:10px;">
<span class="detail-label" style="font-weight:600;color:#555;font-size:13px;display:block;margin-bottom:5px;line-height:1.4;">${label}</span>
<span class="detail-value" style="color:#133730;font-size:14px;font-weight:600;display:block;word-wrap:break-word;line-height:1.5;">${valueHtml}</span>
</td>
</tr>`;
}

/**
 * @param {object} booking - Mongoose doc or plain object
 * @param {Map} packageDetailsMap - packageId string -> Package doc
 */
async function sendCancellationEmail(booking, packageDetailsMap = new Map(), options = {}) {
    const { skipMultiActivitySplit = false } = options;
    const plain = booking.toObject ? booking.toObject() : { ...booking };
    const acts = plain.activities || [];
    const hasCabins = !!(plain.cabins?.length || plain.cabinId);
    if (!skipMultiActivitySplit && acts.length > 1 && !hasCabins) {
        for (const act of acts) {
            const slice = {
                ...plain,
                activities: [act],
                totalAmount: act.amount,
                checkInDate: act.checkInDate,
                checkOutDate: act.checkOutDate
            };
            await sendCancellationEmail(slice, packageDetailsMap, { skipMultiActivitySplit: true });
        }
        return;
    }

    const guestEmail = booking.guestDetails?.email;
    if (!guestEmail) {
        console.log(`[CancellationEmail] Skipping: no guest email for ${booking?.bookingReference || 'unknown'}`);
        return;
    }

    const guestName =
        `${booking.guestDetails?.firstName || ''} ${booking.guestDetails?.lastName || ''}`.trim() || 'Guest';
    const guestPhoneLine = formatGuestPhoneForEmail(booking.guestDetails);
    const cur = normalizeCurrencyCode(booking.currency);

    const hasActivities = Array.isArray(booking.activities) && booking.activities.length > 0;
    const hasCabinStay =
        !!booking.cabinId ||
        (Array.isArray(booking.cabins) && booking.cabins.length > 0);
    const isActivityBooking = hasActivities && !hasCabinStay;

    const policyAnchor = getRefundPolicyAnchorDate(booking);
    const refundMessage = buildRefundMessage(
        policyAnchor,
        booking.cancelledAt,
        isActivityBooking
    );
    const { totalPaid, refundedAmount } = calculateRefundAmounts(
        policyAnchor,
        booking.cancelledAt,
        booking.totalAmount,
        isActivityBooking,
        booking.paymentStatus,
        booking.cancellationFee
    );
    const refundEligibility = getRefundEligibilityLabel(
        policyAnchor,
        booking.cancelledAt,
        isActivityBooking,
        booking.paymentStatus
    );

    const c = booking.cabins?.[0];
    const cabinName = c?.cabinName || booking.cabinId?.name || null;
    const cabinCheckIn = c?.checkInDate || booking.checkInDate;
    const cabinCheckOut = c?.checkOutDate || booking.checkOutDate;
    const adults = c?.adults ?? booking.adults ?? 0;
    const children = c?.children ?? booking.children ?? 0;
    const guestsLabel = `${adults} Adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} Child${children !== 1 ? 'ren' : ''}` : ''}`;

    const cabinPackages = c?.packages?.length ? c.packages : booking.package || [];

    let subjectSuffix = '';
    if (hasActivities && booking.activities[0]?.activityName) {
        subjectSuffix = ` - ${booking.activities[0].activityName}`;
    } else if (cabinName) {
        subjectSuffix = ` - ${cabinName}`;
    }
    const emailSubject = `Booking Cancellation - Reference: ${booking.bookingReference}${subjectSuffix}`;

    let detailsRows = '';
    detailsRows += detailRow('Booking Reference:', escapeHtml(booking.bookingReference));
    if (guestPhoneLine) {
        detailsRows += detailRow('Phone:', escapeHtml(guestPhoneLine));
    }

    if (hasCabinStay) {
        detailsRows += detailRow('Cabin:', escapeHtml(cabinName || 'N/A'));
        detailsRows += detailRow('Check-in Date:', escapeHtml(formatDateLong(cabinCheckIn)));
        detailsRows += detailRow('Check-out Date:', escapeHtml(formatDateLong(cabinCheckOut)));
        detailsRows += detailRow('Guests:', escapeHtml(guestsLabel));
    }

    if (hasActivities) {
        const multiAct = booking.activities.length > 1;
        for (const act of booking.activities) {
            const ticketsHtml = activityTicketLinesHtml(act);
            const actCur = normalizeCurrencyCode(act.currency || cur);
            detailsRows += `
<tr><td colspan="1" style="padding:12px 0 4px 0;">
<p style="margin:0;font-size:15px;font-weight:bold;color:#133730;border-bottom:1px solid #e9ecef;padding-bottom:8px;">Activity</p>
</td></tr>`;
            detailsRows += detailRow('Activity name:', escapeHtml(act.activityName || 'Activity'));
            detailsRows += detailRow('Activity date:', escapeHtml(formatActivityDate(act.checkInDate)));
            detailsRows += detailRow('Tickets:', ticketsHtml || escapeHtml('—'));
            if (multiAct) {
                detailsRows += detailRow('Line amount:', escapeHtml(fmtAmount(act.amount, actCur)));
            }
        }
    }

    if (!hasCabinStay && hasActivities) {
        detailsRows += detailRow('Total Amount:', escapeHtml(fmtAmount(booking.totalAmount, cur)));
    } else if (hasCabinStay) {
        detailsRows += detailRow('Total Amount:', escapeHtml(fmtAmount(booking.totalAmount, cur)));
    }

    if (booking.paymentStatus === 'paid') {
        const baseAmount = Number(booking.subTotal) || 0;
        const discountAmount = Number(booking.discount) || 0;
        if (baseAmount > 0 && discountAmount > 0) {
            detailsRows += detailRow('Amount:', escapeHtml(fmtAmount2(baseAmount, cur)));
            detailsRows += detailRow(
                'Discount Applied:',
                escapeHtml(`- ${fmtAmount2(discountAmount, cur)}`)
            );
        }
        detailsRows += detailRow('Amount Paid:', escapeHtml(fmtAmount2(totalPaid, cur)));
        detailsRows += detailRow('Refund Eligibility:', escapeHtml(refundEligibility));
        detailsRows += detailRow('Refund Amount:', escapeHtml(fmtAmount2(refundedAmount, cur)));
    }

    if (booking.cancellationReason) {
        detailsRows += detailRow('Reason:', escapeHtml(booking.cancellationReason));
    }

    let packagesHtml = '';
    if (cabinPackages.length > 0) {
        const blocks = cabinPackages
            .map((pkg, index) => {
                const packageDetails = packageDetailsMap.get(pkg.packageId?.toString());
                return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="booking-details-box" style="background-color:#ffffff;border:2px solid #133730;padding:15px;margin-bottom:${index < cabinPackages.length - 1 ? '15px' : '0'};">
${detailRow('Package Name:', escapeHtml(packageDetails?.title || pkg.name || 'N/A'))}
<tr>
<td class="detail-item" style="background-color:#e8f5e9;border-left:4px solid #2c5f2d;padding:12px 15px;margin-bottom:0;">
<span class="detail-value" style="color:#2c5f2d;font-size:15px;font-weight:600;display:block;word-wrap:break-word;line-height:1.5;">
${escapeHtml(normalizeCurrencyCode(pkg.currency || cur))} ${Number(pkg.amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
</span>
</td>
</tr>
</table>`;
            })
            .join('');
        packagesHtml = `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr>
<td class="info-box" style="background-color:#f8f9fa;border:2px solid #e9ecef;padding:20px;margin-bottom:20px;">
<p class="info-box-title" style="font-size:17px;font-weight:bold;color:#133730;margin:0 0 15px 0;padding-bottom:10px;border-bottom:2px solid #133730;line-height:1.4;">Selected Packages</p>
${blocks}
</td>
</tr>
</table>`;
    }

    const emailMessage = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
body{margin:0!important;padding:0!important;background-color:#f0f4f8;font-family:'Segoe UI',Tahoma,Geneva,Verdana,Arial,sans-serif;line-height:1.6;color:#333;}
table{border-collapse:collapse;}
.main-container{max-width:650px;width:100%;margin:0 auto;background-color:#ffffff;}
.header{background-color:#133730;padding:25px 20px;text-align:center;}
.content-wrapper{padding:30px 25px;background-color:#ffffff;}
.cancellation-box{background-color:#fff3cd;border:2px solid #ffc107;padding:25px 20px;margin-bottom:25px;text-align:center;}
.info-box{background-color:#f8f9fa;border:2px solid #e9ecef;padding:20px;margin-bottom:20px;}
.info-box-title{font-size:17px;font-weight:bold;color:#133730;margin:0 0 15px 0;padding-bottom:10px;border-bottom:2px solid #133730;line-height:1.4;}
.booking-details-box{background-color:#ffffff;border:2px solid #133730;padding:15px;}
.detail-item{background-color:#f8f9fa;border-left:4px solid #133730;padding:12px 15px;margin-bottom:10px;}
.detail-label{font-weight:600;color:#555;font-size:13px;display:block;margin-bottom:5px;line-height:1.4;}
.detail-value{color:#133730;font-size:14px;font-weight:600;display:block;word-wrap:break-word;line-height:1.5;}
.refund-notice{background-color:#e8f5e9;border:2px solid #2c5f2d;padding:20px;margin:15px 0;}
.refund-notice-title{font-size:17px;font-weight:bold;color:#2c5f2d;margin:0 0 10px 0;line-height:1.4;}
.refund-notice-text{color:#2d5a3d;font-size:14px;line-height:1.6;margin:0;}
.footer{background-color:#133730;color:#ffffff;text-align:center;padding:20px;font-size:11px;line-height:1.6;}
.footer p{margin:5px 0;color:#e0e0e0;}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f4f8;">
<table role="presentation" width="100%" style="background-color:#f0f4f8;">
<tr><td align="center" style="padding:15px 10px;">
<table role="presentation" class="main-container" width="650" style="max-width:650px;width:100%;background-color:#ffffff;">
<tr><td class="header" style="background-color:#133730;padding:25px 20px;text-align:center;">
<p style="font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:2px;margin:0;line-height:1.3;">PALM ISLAND RESORT</p>
</td></tr>
<tr><td class="content-wrapper" style="padding:30px 25px;background-color:#ffffff;">
<table role="presentation" width="100%">
<tr><td class="cancellation-box" style="background-color:#fff3cd;border:2px solid #ffc107;padding:25px 20px;text-align:center;">
<p style="font-size:22px;font-weight:bold;color:#856404;margin:0 0 12px 0;line-height:1.3;">✓ Cancellation Received</p>
<p style="font-size:15px;color:#856404;line-height:1.7;margin:0;">
Hi ${escapeHtml(guestName)},<br><br>
We've received your cancellation for Palm Island Resort — all set!
</p>
</td></tr>
</table>
<table role="presentation" width="100%">
<tr><td style="background-color:#f8f9fa;border-top:3px solid #133730;padding:25px 20px;margin-top:25px;">
<p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 12px 0;">We're sorry you won't be joining us this time, but we hope to host you soon!</p>
${
    booking.paymentStatus === 'paid'
        ? `<table role="presentation" width="100%" class="refund-notice" style="background-color:#e8f5e9;border:2px solid #2c5f2d;padding:20px;margin:15px 0;">
<tr><td>
<p class="refund-notice-title" style="font-size:17px;font-weight:bold;color:#2c5f2d;margin:0 0 10px 0;line-height:1.4;">Refund Information</p>
<p class="refund-notice-text" style="color:#2d5a3d;font-size:14px;line-height:1.6;margin:0;">${escapeHtml(refundMessage)}</p>
</td></tr>
</table>`
        : ''
}
<p style="font-size:14px;line-height:1.7;color:#333;margin:0;">Thanks again for choosing Palm Island Resort.</p>
</td></tr>
</table>
<table role="presentation" width="100%">
<tr><td class="info-box" style="background-color:#f8f9fa;border:2px solid #e9ecef;padding:20px;margin-bottom:20px;">
<p class="info-box-title" style="font-size:17px;font-weight:bold;color:#133730;margin:0 0 15px 0;padding-bottom:10px;border-bottom:2px solid #133730;line-height:1.4;">Cancelled Booking Details</p>
<table role="presentation" width="100%" class="booking-details-box" style="background-color:#ffffff;border:2px solid #133730;padding:15px;">
${detailsRows}
</table>
</td></tr>
</table>
${packagesHtml}
<table role="presentation" width="100%">
<tr><td style="background-color:#f8f9fa;border-top:3px solid #133730;padding:25px 20px;">
<p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 12px 0;">If you have any questions about this cancellation, please contact us.</p>
<p style="font-size:15px;color:#133730;margin:0;">Best regards,<br><strong>Palm Island Resort Team</strong><br>
<span style="font-size:13px;color:#666;">Email: info@palmislandgh.com<br>Phone: +233 53 646 3111</span></p>
</td></tr>
</table>
</td></tr>
<tr><td class="footer" style="background-color:#133730;color:#ffffff;text-align:center;padding:20px;font-size:11px;">
<p style="margin:5px 0;color:#e0e0e0;">This is an automated email. Please do not reply.</p>
<p style="margin:5px 0;color:#e0e0e0;">&copy; ${new Date().getFullYear()} Palm Island Resort</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

    await sendEmail({
        to: guestEmail,
        subject: emailSubject,
        message: emailMessage,
        bcc: 'info@palmislandgh.com'
    });
    console.log(`[CancellationEmail] Sent to ${guestEmail} for ${booking.bookingReference}${subjectSuffix}`);
}

module.exports = { sendCancellationEmail, buildRefundMessage };
