const Booking = require('./bookingModel');

/**
 * Resolve booking row(s) for a gateway payment reference.
 * Split cart checkouts: several documents share the same bookingReference.
 */
async function findBookingsByPaymentReference(reference) {
    const ref = String(reference || '').trim();
    if (!ref) return { bookings: [], isGroup: false };

    const byRef = await Booking.find({ bookingReference: ref, isDeleted: false }).sort({ _id: 1 });
    if (byRef.length > 0) {
        return { bookings: byRef, isGroup: byRef.length > 1 };
    }

    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixMatches = await Booking.find({
        bookingReference: new RegExp(`^${escaped}`),
        isDeleted: false
    }).sort({ _id: 1 });

    if (prefixMatches.length === 0) {
        return { bookings: [], isGroup: false };
    }

    return { bookings: [prefixMatches[0]], isGroup: false };
}

function sumBookingTotals(bookings) {
    return bookings.reduce((s, b) => s + (Number(b.totalAmount) || 0), 0);
}

module.exports = {
    findBookingsByPaymentReference,
    sumBookingTotals
};
