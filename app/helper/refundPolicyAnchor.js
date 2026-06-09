/**
 * Date used for cancellation refund policy (7+ days full, 1–6 days 50%, same-day none).
 * Prefer activity scheduled date over stay check-in when activities exist.
 */
function getRefundPolicyAnchorDate(booking) {
    if (!booking) return null;
    const acts = booking.activities;
    if (Array.isArray(acts) && acts.length > 0 && acts[0]?.checkInDate) {
        return new Date(acts[0].checkInDate);
    }
    const cabins = booking.cabins;
    if (Array.isArray(cabins) && cabins.length > 0 && cabins[0]?.checkInDate) {
        return new Date(cabins[0].checkInDate);
    }
    if (booking.checkInDate) return new Date(booking.checkInDate);
    return null;
}

module.exports = { getRefundPolicyAnchorDate };
