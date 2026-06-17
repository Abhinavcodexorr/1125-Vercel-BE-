const mongoose = require('mongoose');
const Booking = require('./bookingModel');
const Cart = require('../Cart/cartModel');
const response = require('../../helper/response');
const hubtelService = require('./hubtelService');
const {
    parseCartItemInput,
    evaluateCartItemAvailability,
    refreshCartAvailability,
    shapeCartResponse,
    getCartItemUnavailableMessage
} = require('../Cart/cartHelper');
const {
    computeNights,
    getHoldExpiresAt,
    getAllRoomBlockingBookings
} = require('../Rooms/roomAvailabilityHelper');
const { evaluateRoomStay } = require('../Rooms/roomWebsiteHelper');

const isObjectId = (value) =>
    mongoose.Types.ObjectId.isValid(value) &&
    String(new mongoose.Types.ObjectId(value)) === String(value);

const buildGuestDetails = (guestDetails) => {
    if (!guestDetails || !guestDetails.firstName || !guestDetails.lastName || !guestDetails.email) {
        return null;
    }
    return {
        firstName: String(guestDetails.firstName).trim(),
        lastName: String(guestDetails.lastName).trim(),
        email: String(guestDetails.email).trim(),
        mobileNumber: String(guestDetails.mobileNumber || guestDetails.phone || '').trim(),
        countryCode: guestDetails.countryCode ? String(guestDetails.countryCode) : undefined,
        address1: guestDetails.address1 ? String(guestDetails.address1) : undefined,
        address2: guestDetails.address2 ? String(guestDetails.address2) : undefined,
        townOrCity: guestDetails.townOrCity ? String(guestDetails.townOrCity) : undefined,
        state: guestDetails.state ? String(guestDetails.state) : undefined,
        country: guestDetails.country ? String(guestDetails.country) : undefined,
        pincode: guestDetails.pincode ? String(guestDetails.pincode) : undefined,
        specialRequests: guestDetails.specialRequests ? String(guestDetails.specialRequests) : undefined
    };
};

const createBookingFromCartItem = async (item, guestDetails, cartId) => {
    const input = {
        checkInDate: item.checkInDate,
        checkOutDate: item.checkOutDate,
        adults: item.adults,
        children: item.children,
        quantity: item.quantity
    };

    const evaluation = await evaluateCartItemAvailability(item.roomId, input);
    if (!evaluation.ok || !evaluation.room) {
        throw new Error(evaluation.message || 'Room not found');
    }
    if (!evaluation.stayEval?.isAvailable) {
        throw new Error(evaluation.stayEval?.unavailableReason || evaluation.message || 'Room not available');
    }

    const nights = computeNights(item.checkInDate, item.checkOutDate);
    const pricePerNight = Number(item.pricePerNight || evaluation.room.price) || 0;
    const subTotal = Number((pricePerNight * nights * item.quantity).toFixed(2));
    const holdExpiresAt = getHoldExpiresAt();

    const booking = new Booking({
        roomId: item.roomId,
        roomSnapshot: item.roomSnapshot,
        checkInDate: item.checkInDate,
        checkOutDate: item.checkOutDate,
        adults: item.adults,
        children: item.children || 0,
        nights,
        roomPricePerNight: pricePerNight,
        roomQuantity: item.quantity,
        guestDetails,
        cartId,
        subTotal,
        totalAmount: subTotal,
        currency: item.currency || evaluation.room.currency || 'GHS',
        paymentMethod: 'Hubtel',
        status: 'Pending',
        paymentStatus: 'incomplete',
        holdExpiresAt
    });

    await booking.save();

    const stay = {
        checkInDate: item.checkInDate,
        checkOutDate: item.checkOutDate,
        adults: item.adults,
        children: item.children,
        requestedQuantity: item.quantity,
        hasStayDates: true,
        validStayDates: item.checkOutDate > item.checkInDate
    };
    const blockingBookings = await getAllRoomBlockingBookings(item.roomId);
    const postSaveEval = evaluateRoomStay(evaluation.room, blockingBookings, stay);
    if (!postSaveEval.isAvailable) {
        await Booking.deleteOne({ _id: booking._id });
        throw new Error(postSaveEval.unavailableReason || 'Room not available');
    }

    return booking;
};

const createRoomBooking = async (req, res) => {
    try {
        const { cartId, guestDetails, roomId } = req.body;
        const guest = buildGuestDetails(guestDetails);
        if (!guest || !guest.mobileNumber) {
            return response.error400(res, 'guestDetails with firstName, lastName, email, and mobileNumber are required');
        }

        let bookings = [];

        if (cartId) {
            const cart = await Cart.findOne({ cartId });
            if (!cart || !cart.items.length) {
                return response.error400(res, 'Cart is empty or not found');
            }

            await refreshCartAvailability(cart);
            if (!cart.items.every((item) => item.isAvailable)) {
                const unavailableItem = cart.items.find((item) => !item.isAvailable);
                const unavailableMessage = unavailableItem
                    ? await getCartItemUnavailableMessage(unavailableItem)
                    : 'One or more cart items are not available';
                return response.error400(res, unavailableMessage, null, {
                    data: shapeCartResponse(cart)
                });
            }

            for (const item of cart.items) {
                const booking = await createBookingFromCartItem(item, guest, cartId);
                bookings.push(booking);
            }

            cart.items = [];
            cart.subTotal = 0;
            await cart.save();
        } else if (roomId) {
            const input = parseCartItemInput(req.body);
            if (!input.checkInDate || !input.checkOutDate || !input.adults) {
                return response.error400(res, 'roomId, checkInDate, checkOutDate, and adults are required');
            }

            const evaluation = await evaluateCartItemAvailability(roomId, input);
            if (evaluation.invalidQuantity) {
                return response.error400(res, 'quantity must be at least 1');
            }
            if (!evaluation.ok || !evaluation.stayEval?.isAvailable) {
                return response.error400(
                    res,
                    evaluation.stayEval?.unavailableReason ||
                        evaluation.message ||
                        `${evaluation.room?.title || 'Room'} not available for selected dates`
                );
            }

            const item = {
                roomId,
                roomSnapshot: {
                    title: evaluation.room.title,
                    slug: evaluation.room.slug,
                    type: evaluation.room.type,
                    price: evaluation.room.price,
                    currency: evaluation.room.currency || 'GHS',
                    guests: evaluation.room.guests,
                    quantity: evaluation.room.quantity || 1
                },
                checkInDate: input.checkInDate,
                checkOutDate: input.checkOutDate,
                adults: input.adults,
                children: input.children,
                quantity: evaluation.resolvedQuantity,
                pricePerNight: evaluation.room.price,
                currency: evaluation.room.currency || 'GHS'
            };

            const booking = await createBookingFromCartItem(item, guest, null);
            bookings.push(booking);
        } else {
            return response.error400(res, 'cartId or roomId is required');
        }

        const totalAmount = bookings.reduce((sum, b) => sum + Number(b.totalAmount || 0), 0);
        const sharedReference = bookings[0].bookingReference;
        if (bookings.length > 1) {
            await Booking.updateMany(
                { _id: { $in: bookings.map((b) => b._id) } },
                { bookingReference: sharedReference }
            );
            bookings.forEach((b) => {
                b.bookingReference = sharedReference;
            });
        }

        let hubtel;
        try {
            hubtel = await hubtelService.initiateCheckout({
                totalAmount,
                description: `1125 room booking ${sharedReference}`,
                clientReference: sharedReference,
                customerPhoneNumber: guest.mobileNumber
            });
        } catch (paymentError) {
            await Booking.deleteMany({ _id: { $in: bookings.map((b) => b._id) } });
            throw paymentError;
        }

        await Booking.updateMany(
            { _id: { $in: bookings.map((b) => b._id) } },
            {
                paymentStatus: 'pending',
                paymentResponse: hubtel.raw
            }
        );

        return response.created201(res, 'Booking created. Complete payment with Hubtel.', {
            bookingReference: sharedReference,
            bookingIds: bookings.map((b) => b._id),
            totalAmount: Number(totalAmount.toFixed(2)),
            currency: bookings[0].currency,
            paymentMethod: 'Hubtel',
            checkoutUrl: hubtel.checkoutUrl,
            holdExpiresAt: bookings[0].holdExpiresAt,
            bookings: bookings.map((b) => b.getFormattedBooking())
        });
    } catch (error) {
        console.error('Create room booking error:', error.message);
        const isAvailabilityError =
            /not available|Room not found|Room not available|cart items/i.test(error.message || '');
        const isHubtelError =
            /Hubtel|Request failed with status code|ENOTFOUND|ERR_INVALID_URL/i.test(error.message || '');
        if (isAvailabilityError || isHubtelError) {
            return response.error400(res, error.message);
        }
        return response.serverError500(res, 'Failed to create booking', error.message);
    }
};

const handleHubtelCallback = async (req, res) => {
    try {
        const body = req.body || {};
        const clientReference = body.ClientReference || body.clientReference;
        if (!clientReference) {
            return response.error400(res, 'ClientReference is required');
        }

        const bookings = await Booking.find({
            bookingReference: clientReference,
            isDeleted: false
        });

        if (!bookings.length) {
            return response.notFound404(res, 'Booking not found');
        }

        let verified = hubtelService.isPaidCallback(body);
        if (!verified) {
            const statusCheck = await hubtelService.verifyTransaction(clientReference);
            verified = statusCheck.isPaid;
        }

        const update = {
            paymentResponse: body,
            transactionId: body.TransactionId || body.transactionId || bookings[0].transactionId
        };

        if (verified) {
            update.paymentStatus = 'paid';
            update.status = 'Confirmed';
            update.paymentDate = new Date();
        } else {
            update.paymentStatus = 'failed';
        }

        await Booking.updateMany({ bookingReference: clientReference, isDeleted: false }, update);

        return res.status(200).json({ success: true, message: 'Callback processed' });
    } catch (error) {
        console.error('Hubtel callback error:', error.message);
        return response.serverError500(res, 'Failed to process Hubtel callback', error.message);
    }
};

const confirmHubtelBooking = async (req, res) => {
    try {
        const reference = req.query.reference || req.query.clientReference || req.params.reference;
        if (!reference) {
            return response.error400(res, 'reference is required');
        }

        const statusCheck = await hubtelService.verifyTransaction(reference);
        const bookings = await Booking.find({ bookingReference: reference, isDeleted: false });

        if (!bookings.length) {
            return response.notFound404(res, 'Booking not found');
        }

        if (statusCheck.isPaid) {
            await Booking.updateMany(
                { bookingReference: reference, isDeleted: false },
                {
                    paymentStatus: 'paid',
                    status: 'Confirmed',
                    paymentDate: new Date(),
                    paymentResponse: statusCheck.raw
                }
            );
        }

        const refreshed = await Booking.find({ bookingReference: reference, isDeleted: false });
        return response.success200(res, 'Booking payment status checked', {
            isPaid: statusCheck.isPaid,
            status: statusCheck.status,
            bookings: refreshed.map((b) => b.getFormattedBooking())
        });
    } catch (error) {
        console.error('Confirm Hubtel booking error:', error.message);
        return response.serverError500(res, 'Failed to confirm booking payment', error.message);
    }
};

const getBookingByReference = async (req, res) => {
    try {
        const { reference } = req.params;
        const bookings = await Booking.find({ bookingReference: reference, isDeleted: false });
        if (!bookings.length) {
            return response.notFound404(res, 'Booking not found');
        }
        return response.success200(res, 'Booking retrieved', {
            bookingReference: reference,
            bookings: bookings.map((b) => b.getFormattedBooking())
        });
    } catch (error) {
        console.error('Get booking by reference error:', error.message);
        return response.serverError500(res, 'Failed to retrieve booking', error.message);
    }
};

module.exports = {
    createRoomBooking,
    handleHubtelCallback,
    confirmHubtelBooking,
    getBookingByReference
};
