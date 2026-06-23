/**
 * Send sample booking emails to info@1125beachvilla.com for visual QA.
 * Usage: node scripts/send-email-template-tests.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sendEmail = require('../app/middleware/mail');
const {
    buildBookingInProgressSubject,
    buildBookingInProgressEmailHtml
} = require('../app/modules/Booking/bookingInProgressEmailTemplate');
const {
    buildBookingConfirmationSubject,
    buildBookingConfirmationEmailHtml
} = require('../app/modules/Booking/bookingConfirmationEmailTemplate');
const {
    buildCancellationSubject,
    buildCancellationEmailHtml
} = require('../app/modules/Booking/bookingCancellationEmailTemplate');

const TEST_RECIPIENT = 'info@1125beachvilla.com';

const sampleBooking = {
    bookingReference: 'BK-TEST-00482',
    checkInDate: new Date('2026-06-27T14:00:00.000Z'),
    checkOutDate: new Date('2026-06-29T11:00:00.000Z'),
    adults: 2,
    children: 0,
    totalAmount: 4500,
    currency: 'GHS',
    paymentStatus: 'paid',
    guestDetails: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        mobileNumber: '+233240000000'
    },
    createdAt: new Date()
};

async function sendInProgressTest() {
    await sendEmail({
        to: TEST_RECIPIENT,
        subject: `[TEST] ${buildBookingInProgressSubject(sampleBooking.bookingReference)}`,
        message: buildBookingInProgressEmailHtml({
            booking: sampleBooking,
            roomName: 'Ocean View Suite',
            submittedAt: sampleBooking.createdAt
        }),
        fromName: '1125 Beach Villa'
    });
    console.log('Sent: Booking In Progress');
}

async function sendConfirmationTest() {
    await sendEmail({
        to: TEST_RECIPIENT,
        subject: `[TEST] ${buildBookingConfirmationSubject(sampleBooking.bookingReference)}`,
        message: buildBookingConfirmationEmailHtml({
            booking: sampleBooking,
            roomName: 'Ocean View Suite'
        }),
        fromName: '1125 Beach Villa'
    });
    console.log('Sent: Booking Confirmation');
}

async function sendCancellationTest() {
    const detailRows = [
        { label: 'Reference', value: sampleBooking.bookingReference, highlight: true },
        { label: 'Room', value: 'Ocean View Suite' },
        { label: 'Check-in', value: 'Fri, Jun 27, 2026' },
        { label: 'Check-out', value: 'Sun, Jun 29, 2026' },
        { label: 'Guests', value: '2 adults' },
        { label: 'Total Amount', value: 'GHS 4,500.00', highlight: true },
        { label: 'Refund Amount', value: 'GHS 4,500.00', highlight: true }
    ];

    await sendEmail({
        to: TEST_RECIPIENT,
        subject: `[TEST] ${buildCancellationSubject(sampleBooking.bookingReference)}`,
        message: buildCancellationEmailHtml({
            guestName: 'John Doe',
            detailRows,
            refundMessage:
                'As your booking was cancelled 7 days or more before the check-in date, you are eligible for a full refund. Refunds are processed within 14 business days.'
        }),
        fromName: '1125 Beach Villa'
    });
    console.log('Sent: Booking Cancellation');
}

async function main() {
    console.log(`Sending template tests to ${TEST_RECIPIENT}...`);
    await sendInProgressTest();
    await sendConfirmationTest();
    await sendCancellationTest();
    console.log('All test emails sent.');
}

main().catch((err) => {
    console.error('Failed to send test emails:', err.message);
    process.exit(1);
});
