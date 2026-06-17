/**
 * Admin bookings list — clear rows for cabin + room bookings.
 */

const Booking = require('./bookingModel');

const formatGuest = (guest = {}) => {
    const firstName = guest.firstName || '';
    const lastName = guest.lastName || '';
    return {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim() || null,
        email: guest.email || null,
        mobileNumber: guest.mobileNumber || null,
        country: guest.country || null
    };
};

const resolveStayName = (booking) => {
    if (booking.roomSnapshot?.title) return booking.roomSnapshot.title;
    if (Array.isArray(booking.cabins) && booking.cabins[0]?.cabinName) {
        return booking.cabins[0].cabinName;
    }
    return null;
};

const resolveBookingType = (booking) => {
    if (booking.roomId) return 'room';
    if (booking.cabinId || (Array.isArray(booking.cabins) && booking.cabins.length)) {
        return 'cabin';
    }
    return 'other';
};

const buildFilterMessage = (filterKey, total) => {
    const labels = {
        paid: 'Paid bookings',
        incomplete: 'Incomplete bookings',
        cancelled: 'Cancelled bookings',
        all: 'Bookings'
    };
    const label = labels[filterKey] || labels.all;
    return `${label} retrieved successfully (${total})`;
};

const formatAdminBookingRow = (bookingDoc, packageLines = null) => {
    const base = bookingDoc.getFormattedBooking();
    const bookingType = resolveBookingType(bookingDoc);
    const stayName = resolveStayName(bookingDoc);

    return {
        _id: base._id,
        bookingReference: base.bookingReference,
        bookingType,
        stayName,
        room: bookingDoc.roomId
            ? {
                  id: base.roomId,
                  name: bookingDoc.roomSnapshot?.title || stayName,
                  slug: bookingDoc.roomSnapshot?.slug || null,
                  type: bookingDoc.roomSnapshot?.type || null,
                  quantity: base.roomQuantity || 1
              }
            : null,
        cabinId: base.cabinId || null,
        cabins: Array.isArray(bookingDoc.cabins) ? bookingDoc.cabins : [],
        checkInDate: base.checkInDate,
        checkOutDate: base.checkOutDate,
        nights: base.nights,
        adults: base.adults,
        children: base.children,
        guest: formatGuest(base.guestDetails),
        amounts: {
            subTotal: base.actualAmount,
            discount: base.discountApplied,
            total: base.amountPaid,
            currency: base.currency
        },
        status: base.status,
        paymentStatus: base.paymentStatus,
        paymentMethod: base.paymentMethod,
        paymentType: base.paymentType,
        paymentDate: base.paymentDate,
        transactionId: base.transactionId,
        package: packageLines,
        cartId: bookingDoc.cartId || null,
        createdAt: base.createdAt,
        updatedAt: base.updatedAt
    };
};

/** Admin dashboard / statistics — confirmed+paid count, cancelled+paid count, confirmed paid revenue. */
const CONFIRMED_PAID_STATUSES = ['Confirmed', 'Checked-In', 'Checked-Out'];

const fetchBookingStatisticsSummary = async () => {
    const [stats] = await Booking.aggregate([
        { $match: { isDeleted: false } },
        {
            $group: {
                _id: null,
                totalBookings: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$paymentStatus', 'paid'] },
                                    { $in: ['$status', CONFIRMED_PAID_STATUSES] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },
                cancelledBookings: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$paymentStatus', 'paid'] },
                                    { $eq: ['$status', 'Cancelled'] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },
                totalRevenue: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$paymentStatus', 'paid'] },
                                    { $in: ['$status', CONFIRMED_PAID_STATUSES] }
                                ]
                            },
                            { $ifNull: ['$totalAmount', 0] },
                            0
                        ]
                    }
                }
            }
        }
    ]);

    return {
        totalBookings: stats?.totalBookings || 0,
        cancelledBookings: stats?.cancelledBookings || 0,
        totalRevenue: Number((stats?.totalRevenue || 0).toFixed(2))
    };
};

module.exports = {
    formatAdminBookingRow,
    buildFilterMessage,
    fetchBookingStatisticsSummary
};
