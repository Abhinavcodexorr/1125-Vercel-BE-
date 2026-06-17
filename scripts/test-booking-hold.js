/**
 * Offline logic test for 15-minute booking holds (no DB required).
 * Run: node scripts/test-booking-hold.js
 */
const { evaluateRoomStay } = require('../app/modules/Rooms/roomWebsiteHelper');
const { getStayQuantityStatus, getRoomQuantity } = require('../app/modules/Rooms/roomAvailabilityHelper');

const room = {
    _id: 'room1',
    title: 'Super Deluxe',
    price: 500,
    guests: 4,
    quantity: 1,
    blockedDates: []
};

const personA = {
    roomId: 'room1',
    roomQuantity: 1,
    checkInDate: new Date('2026-06-15'),
    checkOutDate: new Date('2026-06-18'),
    status: 'Pending',
    paymentStatus: 'incomplete'
};

const personBStay = {
    checkInDate: new Date('2026-06-16'),
    checkOutDate: new Date('2026-06-19'),
    adults: 2,
    children: 0,
    requestedQuantity: 1,
    hasStayDates: true,
    validStayDates: true
};

let passed = 0;
let failed = 0;

const assert = (name, condition) => {
    if (condition) {
        passed += 1;
        console.log(`  PASS: ${name}`);
    } else {
        failed += 1;
        console.error(`  FAIL: ${name}`);
    }
};

console.log('\n=== Booking hold logic tests ===\n');

// No bookings — Person B should be available
const emptyEval = evaluateRoomStay(room, [], personBStay);
assert('Empty calendar allows overlapping dates', emptyEval.isAvailable === true);

// Person A hold blocks Person B (overlapping 16–18)
const withHoldEval = evaluateRoomStay(room, [personA], personBStay);
assert('Active hold blocks overlapping booking', withHoldEval.isAvailable === false);
assert(
    'Hold error uses room name',
    withHoldEval.unavailableReason ===
        'Super Deluxe is not available for the selected dates. Please choose other dates.'
);

// Non-overlapping dates should still work
const nonOverlapStay = {
    ...personBStay,
    checkInDate: new Date('2026-06-20'),
    checkOutDate: new Date('2026-06-22')
};
const nonOverlapEval = evaluateRoomStay(room, [personA], nonOverlapStay);
assert('Non-overlapping dates still available with active hold', nonOverlapEval.isAvailable === true);

// Confirmed paid booking blocks same as hold
const confirmedBooking = {
    ...personA,
    status: 'Confirmed',
    paymentStatus: 'paid'
};
const confirmedEval = evaluateRoomStay(room, [confirmedBooking], personBStay);
assert('Confirmed paid booking blocks overlap', confirmedEval.isAvailable === false);

// Multi-unit room: 2 units, 1 hold — second unit still bookable
const multiRoom = { ...room, title: 'Family Suite', quantity: 2 };
const multiEval = evaluateRoomStay(multiRoom, [personA], personBStay);
assert('Multi-unit room allows booking when 1 unit still free', multiEval.isAvailable === true);

const qtyStatus = getStayQuantityStatus(
    multiRoom,
    [personA, { ...personA, bookingReference: 'OTHER' }],
    personBStay.checkInDate,
    personBStay.checkOutDate,
    1
);
assert('Multi-unit full when 2 holds overlap', qtyStatus.available === false);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
