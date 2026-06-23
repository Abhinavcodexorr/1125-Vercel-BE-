/**
 * Guest cancellation email (split bookings: one row = one cabin or one activity).
 * Refund policy uses activity date or stay check-in (see getRefundPolicyAnchorDate), not createdAt.
 */
const sendEmail = require('../../middleware/mail');
const { getRefundPolicyAnchorDate } = require('../../helper/refundPolicyAnchor');
const { getCurrencyDisplayPrefix, normalizeCurrencyCode } = require('../../helper/currencyHelper');
const {
    buildCancellationSubject,
    buildCancellationEmailHtml,
    getCancellationVillaRecipient
} = require('./bookingCancellationEmailTemplate');

function activityTicketLines(act) {
    const parts = [];
    if ((act.single || 0) > 0) parts.push(`Per Person x ${act.single}`);
    if ((act.couple || 0) > 0) parts.push(`2 Persons x ${act.couple}`);
    if ((act.groupOfFour || 0) > 0) parts.push(`Group of 4 x ${act.groupOfFour}`);
    if ((act.children || 0) > 0) parts.push(`Children x ${act.children}`);
    return parts.join(', ');
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
    if (isNaN(x.getTime())) return 'N/A';
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

function pushDetailRow(rows, label, value, highlight = false) {
    if (value === undefined || value === null || value === '') return;
    rows.push({ label, value, highlight });
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
        (Array.isArray(booking.cabins) && booking.cabins.length > 0) ||
        !!booking.roomId ||
        !!booking.roomSnapshot;
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

    const c = booking.cabins?.[0];
    const cabinName = c?.cabinName || booking.cabinId?.name || booking.roomSnapshot?.title || null;
    const cabinCheckIn = c?.checkInDate || booking.checkInDate;
    const cabinCheckOut = c?.checkOutDate || booking.checkOutDate;
    const adults = c?.adults ?? booking.adults ?? 0;
    const children = c?.children ?? booking.children ?? 0;
    const guestsLabel = `${adults} adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} child${children !== 1 ? 'ren' : ''}` : ''}`;

    let subjectSuffix = '';
    if (hasActivities && booking.activities[0]?.activityName) {
        subjectSuffix = ` - ${booking.activities[0].activityName}`;
    } else if (cabinName) {
        subjectSuffix = ` - ${cabinName}`;
    }

    const detailRows = [];
    pushDetailRow(detailRows, 'Reference', booking.bookingReference, true);
    if (guestPhoneLine) {
        pushDetailRow(detailRows, 'Phone', guestPhoneLine);
    }

    if (hasCabinStay) {
        pushDetailRow(detailRows, 'Room', cabinName || 'N/A');
        pushDetailRow(detailRows, 'Check-in', formatDateLong(cabinCheckIn));
        pushDetailRow(detailRows, 'Check-out', formatDateLong(cabinCheckOut));
        pushDetailRow(detailRows, 'Guests', guestsLabel);
    }

    if (hasActivities) {
        const multiAct = booking.activities.length > 1;
        for (const act of booking.activities) {
            const tickets = activityTicketLines(act);
            const actCur = normalizeCurrencyCode(act.currency || cur);
            pushDetailRow(detailRows, 'Activity', act.activityName || 'Activity');
            pushDetailRow(detailRows, 'Activity Date', formatDateLong(act.checkInDate));
            if (tickets) {
                pushDetailRow(detailRows, 'Tickets', tickets);
            }
            if (multiAct) {
                pushDetailRow(detailRows, 'Line Amount', fmtAmount2(act.amount, actCur));
            }
        }
    }

    pushDetailRow(detailRows, 'Total Amount', fmtAmount2(booking.totalAmount, cur), true);

    if (booking.paymentStatus === 'paid') {
        const baseAmount = Number(booking.subTotal) || 0;
        const discountAmount = Number(booking.discount) || 0;
        if (baseAmount > 0 && discountAmount > 0) {
            pushDetailRow(detailRows, 'Amount', fmtAmount2(baseAmount, cur));
            pushDetailRow(detailRows, 'Discount', `- ${fmtAmount2(discountAmount, cur)}`);
        }
        pushDetailRow(detailRows, 'Amount Paid', fmtAmount2(totalPaid, cur));
        pushDetailRow(detailRows, 'Refund Amount', fmtAmount2(refundedAmount, cur), true);
    }

    if (booking.cancellationReason) {
        pushDetailRow(detailRows, 'Reason', booking.cancellationReason);
    }

    const cabinPackages = c?.packages?.length ? c.packages : booking.package || [];
    if (cabinPackages.length > 0) {
        const packageNames = cabinPackages
            .map((pkg) => {
                const packageDetails = packageDetailsMap.get(pkg.packageId?.toString());
                return packageDetails?.title || pkg.name || 'Package';
            })
            .join(', ');
        pushDetailRow(detailRows, 'Packages', packageNames);
    }

    const emailSubject = buildCancellationSubject(booking.bookingReference, subjectSuffix);
    const emailMessage = buildCancellationEmailHtml({
        guestName,
        detailRows,
        refundMessage: booking.paymentStatus === 'paid' ? refundMessage : ''
    });

    await sendEmail({
        to: guestEmail,
        subject: emailSubject,
        message: emailMessage,
        bcc: getCancellationVillaRecipient(),
        fromName: '1125 Beach Villa'
    });
    console.log(
        `[CancellationEmail] Sent to ${guestEmail} (bcc ${getCancellationVillaRecipient()}) for ${booking.bookingReference}${subjectSuffix}`
    );
}

module.exports = { sendCancellationEmail, buildRefundMessage };
