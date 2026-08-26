/**
 * Static room combo conflicts (2 Bedroom Suite = Standard + Deluxe).
 *
 * Rules:
 * - Book Suite  → Standard AND Deluxe unavailable for those dates
 * - Book Standard alone → Suite unavailable; Deluxe still available
 * - Book Deluxe alone  → Suite unavailable; Standard still available
 * - Standard and Deluxe never block each other
 *
 * To change rooms later, update the IDs below only.
 */
module.exports = {
    ROOM_COMBO_CONFLICTS: [
        {
            name: '2 Bedroom Suite (Standard + Deluxe)',
            // Sold as one product (uses both component rooms)
            comboRoomId: '6a8ed1488e8dfb9c34a9ba1f', // 2 Bedroom Suite
            componentRoomIds: [
                '6a33794aeeff7a585937bc97', // Standard Room
                '6a33784feeff7a585937bc85' // Deluxe Room
            ]
        }
    ]
};
