/**
 * MongoDB fragments for cart-based bookings: cabin stay vs activity-only.
 * Activity-only: activities[] but no cabins[] and no root cabinId (after save).
 */
const bookingHasCabinStayMongo = {
    $or: [{ cabinId: { $exists: true, $ne: null } }, { 'cabins.0': { $exists: true } }]
};

/** Activity-only rows: has activities[] and no cabin stay (no root cabinId, no cabins[]). */
const bookingHasActivityOnlyMongo = {
    $and: [
        { 'activities.0': { $exists: true } },
        {
            $nor: [
                { cabinId: { $exists: true, $ne: null } },
                { 'cabins.0': { $exists: true } }
            ]
        }
    ]
};

module.exports = { bookingHasCabinStayMongo, bookingHasActivityOnlyMongo };
