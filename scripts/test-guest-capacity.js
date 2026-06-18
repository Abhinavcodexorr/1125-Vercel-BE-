/**
 * Offline tests for quantity-scaled guest capacity (no DB required).
 * Run: node scripts/test-guest-capacity.js
 */
const { evaluateRoomStay, filterRoomsForStay } = require('../app/modules/Rooms/roomWebsiteHelper');
const {
    getMaxGuestsForStay,
    formatRoomMaxGuestCapacity
} = require('../app/modules/Rooms/roomAvailabilityHelper');

const chaletProperty = {
    _id: 'villa1',
    title: 'The Villa',
    price: 350,
    guests: 2,
    quantity: 5,
    blockedDates: []
};

const stayBase = {
    checkInDate: new Date('2026-06-20'),
    checkOutDate: new Date('2026-06-21'),
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

console.log('\n=== Guest capacity (per chalet × quantity) tests ===\n');

assert('5 chalets × 2 guests = 10 max', getMaxGuestsForStay(chaletProperty, 5) === 10);
assert(
    'Capacity message mentions total and units',
    formatRoomMaxGuestCapacity(chaletProperty, 5).includes('10 Guests') &&
        formatRoomMaxGuestCapacity(chaletProperty, 5).includes('5 chalet')
);

const fiveChaletsTenAdults = evaluateRoomStay(chaletProperty, [], {
    ...stayBase,
    adults: 10,
    children: 0,
    requestedQuantity: 5
});
assert('10 adults across 5 chalets is allowed', fiveChaletsTenAdults.isAvailable === true);
assert('maxTotalGuests is 10', fiveChaletsTenAdults.maxTotalGuests === 10);

const fiveChaletsMixed = evaluateRoomStay(chaletProperty, [], {
    ...stayBase,
    adults: 6,
    children: 4,
    requestedQuantity: 5
});
assert('6 adults + 4 children (=10) across 5 chalets is allowed', fiveChaletsMixed.isAvailable === true);

const fiveChaletsTooMany = evaluateRoomStay(chaletProperty, [], {
    ...stayBase,
    adults: 8,
    children: 4,
    requestedQuantity: 5
});
assert('8 adults + 4 children (=12) across 5 chalets is blocked', fiveChaletsTooMany.isAvailable === false);
assert('Capacity failure type', fiveChaletsTooMany.failureType === 'capacity');

const oneChaletTwoAdults = evaluateRoomStay(chaletProperty, [], {
    ...stayBase,
    adults: 2,
    children: 0,
    requestedQuantity: 1
});
assert('2 adults in 1 chalet is allowed', oneChaletTwoAdults.isAvailable === true);

const oneChaletThreeAdults = evaluateRoomStay(chaletProperty, [], {
    ...stayBase,
    adults: 3,
    children: 0,
    requestedQuantity: 1
});
assert('3 adults in 1 chalet is blocked', oneChaletThreeAdults.isAvailable === false);

const scaledWithMoreChalets = evaluateRoomStay(chaletProperty, [], {
    ...stayBase,
    adults: 6,
    children: 0,
    requestedQuantity: 3
});
assert('6 adults across 3 chalets (max 6) is allowed', scaledWithMoreChalets.isAvailable === true);

const filtered = filterRoomsForStay([chaletProperty], {
    adults: 10,
    children: 0,
    requestedQuantity: null
});
assert('Listing filter keeps room when 10 adults fit in 5 chalets total', filtered.length === 1);

const filteredOut = filterRoomsForStay([chaletProperty], {
    adults: 12,
    children: 0,
    requestedQuantity: null
});
assert('Listing filter removes room when 12 adults exceed 5×2 capacity', filteredOut.length === 0);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
