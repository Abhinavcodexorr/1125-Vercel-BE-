/**
 * Admin bookings list — clear rows for cabin + room bookings.
 */

const Booking = require('./bookingModel');
const Room = require('../Rooms/roomModel');
const {
    getRoomQuantity,
    getQuantityOverrideMap,
    getEffectiveQuantityForDate,
    buildBookingCountByDate,
    getRoomBlockedDateData,
    getRoomBlockingBookingsByRoomIds,
    collectBookingsForRoomAvailability,
    getConflictPartnerBlockedDateDocs,
    toDateOnly,
    formatDateKey
} = require('../Rooms/roomAvailabilityHelper');

const formatGuest = (guest = {}) => {
    const firstName = guest.firstName || '';
    const lastName = guest.lastName || '';
    const specialRequests =
        guest.specialRequests ||
        guest.specialRequest ||
        guest.special_requests ||
        guest.special_request ||
        null;
    return {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim() || null,
        email: guest.email || null,
        mobileNumber: guest.mobileNumber || null,
        countryCode: guest.countryCode || null,
        country: guest.country || null,
        address1: guest.address1 || null,
        address2: guest.address2 || null,
        townOrCity: guest.townOrCity || null,
        state: guest.state || null,
        pincode: guest.pincode || null,
        specialRequests,
        specialRequest: specialRequests
    };
};

const resolveStayName = (booking) => {
    if (booking.roomSnapshot?.title) return booking.roomSnapshot.title;
    if (Array.isArray(booking.cabins) && booking.cabins[0]?.cabinName) {
        return booking.cabins[0].cabinName;
    }
    if (booking.cabinId?.name) return booking.cabinId.name;
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
    const stayTitle = resolveStayName(bookingDoc);
    const specialRequests =
        base.specialRequests ||
        base.specialRequest ||
        base.guestDetails?.specialRequests ||
        base.guestDetails?.specialRequest ||
        bookingDoc.specialRequests ||
        bookingDoc.specialRequest ||
        bookingDoc.guestDetails?.specialRequests ||
        bookingDoc.guestDetails?.specialRequest ||
        null;

    return {
        _id: base._id,
        bookingReference: base.bookingReference,
        bookingType,
        title: stayTitle,
        roomTitle: stayTitle,
        stayName: stayTitle,
        name: stayTitle,
        room: bookingDoc.roomId
            ? {
                  id: base.roomId,
                  title: stayTitle,
                  name: stayTitle,
                  slug: bookingDoc.roomSnapshot?.slug || null,
                  type: bookingDoc.roomSnapshot?.type || null,
                  quantity: base.roomQuantity || 1
              }
            : null,
        cabinId: base.cabinId || null,
        cabinName: stayTitle,
        cabins: Array.isArray(bookingDoc.cabins) ? bookingDoc.cabins : [],
        checkInDate: base.checkInDate,
        checkOutDate: base.checkOutDate,
        nights: base.nights,
        adults: base.adults,
        children: base.children,
        guest: formatGuest(base.guestDetails || bookingDoc.guestDetails),
        specialRequests,
        specialRequest: specialRequests,
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
        cancelledAt: base.cancelledAt || null,
        cancellationReason: base.cancellationReason || null,
        cancellationFee: base.cancellationFee ?? 0,
        package: packageLines,
        cartId: bookingDoc.cartId || null,
        createdAt: base.createdAt,
        updatedAt: base.updatedAt
    };
};

/** Admin dashboard / statistics — totals aligned with booking list filters. */
const COMPLETED_STATUSES = ['Confirmed', 'Checked-In', 'Checked-Out'];

const fetchBookingStatisticsSummary = async () => {
    const [stats] = await Booking.aggregate([
        { $match: { isDeleted: false } },
        {
            $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                // Complete = paid and not cancelled (admin filter=paid)
                completedBookings: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$paymentStatus', 'paid'] },
                                    { $ne: ['$status', 'Cancelled'] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },
                // Pending / incomplete = not paid and not cancelled (admin filter=incomplete)
                pendingBookings: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $not: { $in: ['$paymentStatus', ['paid', 'refunded']] } },
                                    { $ne: ['$status', 'Cancelled'] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                },
                cancelledBookings: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0]
                    }
                },
                // Revenue from paid non-cancelled bookings
                totalRevenue: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$paymentStatus', 'paid'] },
                                    { $ne: ['$status', 'Cancelled'] }
                                ]
                            },
                            { $ifNull: ['$totalAmount', 0] },
                            0
                        ]
                    }
                },
                confirmedBookings: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$paymentStatus', 'paid'] },
                                    { $in: ['$status', COMPLETED_STATUSES] }
                                ]
                            },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    const totalBookings = stats?.totalBookings || 0;
    const completedBookings = stats?.completedBookings || 0;
    const pendingBookings = stats?.pendingBookings || 0;
    const cancelledBookings = stats?.cancelledBookings || 0;
    const totalRevenue = Number((stats?.totalRevenue || 0).toFixed(2));

    // Live room availability counts for admin dashboard
    let totalRooms = 0;
    let availableRooms = 0;
    let occupiedRooms = 0;

    try {
        const activeRooms = await Room.find({ isDeleted: false, isActive: true }).lean();
        const roomIds = activeRooms.map((r) => r._id);
        const allBookings = await getRoomBlockingBookingsByRoomIds(roomIds);
        const bookingsByRoom = {};
        allBookings.forEach((b) => {
            const key = String(b.roomId);
            if (!bookingsByRoom[key]) bookingsByRoom[key] = [];
            bookingsByRoom[key].push(b);
        });

        const today = toDateOnly(new Date());
        const todayKey = formatDateKey(today);

        for (const r of activeRooms) {
            const maxQty = getRoomQuantity(r);
            totalRooms += maxQty;

            const bookings = collectBookingsForRoomAvailability(r._id, bookingsByRoom);
            const bookingCountByDate = buildBookingCountByDate(bookings);
            const bookedToday = bookingCountByDate.get(todayKey) || 0;
            occupiedRooms += bookedToday;

            const overrideMap = getQuantityOverrideMap(r);
            const dayQty = getEffectiveQuantityForDate(r, todayKey, overrideMap);

            const partnerBlocked = await getConflictPartnerBlockedDateDocs(r._id);
            const effectiveBlocked = [...(r.blockedDates || []), ...partnerBlocked];
            const { blockedDates: blockedKeyList } = getRoomBlockedDateData(effectiveBlocked);
            const isBlockedToday = blockedKeyList.includes(todayKey);

            const availToday = isBlockedToday ? 0 : Math.max(dayQty - bookedToday, 0);
            availableRooms += availToday;
        }
    } catch (roomStatsError) {
        console.error('Failed to compute room availability stats:', roomStatsError.message);
    }

    return {
        totalBookings,
        pendingBookings,
        completedBookings,
        cancelledBookings,
        totalRevenue,
        // Live room counts for admin dashboard
        totalRooms,
        totalUnits: totalRooms,
        totalQuantity: totalRooms,
        availableRooms,
        availableUnits: availableRooms,
        availableCount: availableRooms,
        availableRoomCount: availableRooms,
        occupiedRooms,
        occupiedUnits: occupiedRooms,
        bookedRooms: occupiedRooms,
        bookedUnits: occupiedRooms,
        occupancyRate: totalRooms > 0 ? Number(((occupiedRooms / totalRooms) * 100).toFixed(1)) : 0,
        // Extra fields used by FE mapper / older clients
        confirmedBookings: stats?.confirmedBookings || completedBookings,
        averageBookingValue:
            completedBookings > 0
                ? Number((totalRevenue / completedBookings).toFixed(2))
                : 0
    };
};

module.exports = {
    formatAdminBookingRow,
    buildFilterMessage,
    fetchBookingStatisticsSummary
};
