const mongoose = require('mongoose');
const Booking = require('./bookingModel');
const { bookingHasCabinStayMongo, bookingAdminListMongo, bookingHasActivityOnlyMongo } =
    require('./bookingQueryHelpers');
const { formatAdminBookingRow, buildFilterMessage } = require('./bookingAdminHelper');
const response = require('../../helper/response');
const sendEmail = require('../../middleware/mail');
const { sendCancellationEmail } = require('./cancellationEmailService');

function buildPackageTitleMapFromBookingDocs(bookings) {
    const map = new Map();
    const addPkg = (pkg) => {
        if (!pkg?.packageId) return;
        const id = pkg.packageId.toString();
        if (!map.has(id)) map.set(id, pkg.name || 'Package');
    };
    const list = Array.isArray(bookings) ? bookings : [bookings];
    list.forEach((b) => {
        (b.package || []).forEach(addPkg);
        (b.cabins || []).forEach((c) => (c.packages || []).forEach(addPkg));
    });
    return map;
}

/** Collect package IDs from booking doc (root package[] or cart cabins[].packages). */
function collectPackageIdsFromBookingDoc(b) {
    const ids = new Set();
    (b.package || []).forEach((p) => p?.packageId && ids.add(p.packageId.toString()));
    (b.cabins || []).forEach((c) => {
        (c.packages || []).forEach((p) => p?.packageId && ids.add(p.packageId.toString()));
    });
    return ids;
}

/** Flatten packages with display name + amount for admin list (uses Package title). */
function buildEnrichedPackageListForBooking(bookingDoc, titleMap) {
    const lines = [];
    const push = (pkg) => {
        if (!pkg) return;
        const pid = pkg.packageId?.toString();
        const snapshotName = pkg.name && String(pkg.name).trim();
        const titleFromDb = pid && titleMap.get(pid);
        const name = snapshotName || titleFromDb || 'Package';
        lines.push({
            packageId: pkg.packageId,
            type: pkg.type,
            amount: pkg.amount,
            currency: pkg.currency,
            name,
            title: titleFromDb || name
        });
    };
    (bookingDoc.package || []).forEach(push);
    (bookingDoc.cabins || []).forEach((c) => (c.packages || []).forEach(push));
    return lines.length ? lines : null;
}

// Create a new booking with payment processing and email notifications
const createBooking = async (req, res) => {
    try {
        const {
            cabinId,
            checkInDate,
            checkOutDate,
            adults,
            children,
            guestDetails,
            paymentMethod ,
            paymentDetails,
            cabinAmount,
            totalAmount,
            currency,
            package: packageArray // Optional - array of packages with packageId, type (required if package provided), amount, currency
        } = req.body;

        const cabin = await Cabin.findOne({ _id: cabinId, isDeleted: false, isActive: true });
        if (!cabin) {
            return response.notFound404(res, "Cabin is not available for booking");
        }

        const checkIn = new Date(checkInDate);
        const checkOut = new Date(checkOutDate);

        if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
            return response.error400(res, "Invalid check-in or check-out date format");
        }

        if (checkIn >= checkOut) {
            return response.error400(res, "Check-in date must be before check-out date");
        }

        // Normalize dates: check-in at 2 PM (14:00), checkout at 11 AM (11:00)
        // This allows same-day transitions (checkout morning, check-in afternoon)
        const checkInDateTime = new Date(checkIn);
        checkInDateTime.setHours(14, 0, 0, 0); // Check-in at 2 PM
        
        const checkOutDateTime = new Date(checkOut);
        checkOutDateTime.setHours(11, 0, 0, 0); // Checkout at 11 AM

        // Check blocked dates first - this takes priority
        if (cabin.availability?.blockedDates && cabin.availability.blockedDates.length > 0) {
            const conflictingBlockedDates = [];
            
            cabin.availability.blockedDates.forEach((blocked) => {
                if (!blocked || !blocked.startDate || !blocked.endDate) {
                    return;
                }

                const blockedStart = new Date(blocked.startDate);
                const blockedEnd = new Date(blocked.endDate);
                
                if (isNaN(blockedStart.getTime()) || isNaN(blockedEnd.getTime())) {
                    return;
                }

                blockedStart.setHours(0, 0, 0, 0);
                blockedEnd.setHours(23, 59, 59, 999);
                
                // Check if requested dates overlap with blocked dates
                // Overlap occurs if: checkInDateTime < blockedEnd AND checkOutDateTime > blockedStart
                const overlaps = (checkInDateTime < blockedEnd && checkOutDateTime > blockedStart);
                
                if (overlaps) {
                    conflictingBlockedDates.push({
                        startDate: blockedStart.toISOString().split('T')[0],
                        endDate: blockedEnd.toISOString().split('T')[0],
                        reason: blocked.reason || "Blocked"
                    });
                    
                    console.log(`🚫 Booking blocked for cabin ${cabin._id} (${cabin.name}): Requested ${checkInDate} to ${checkOutDate} overlaps with blocked ${blockedStart.toISOString().split('T')[0]} to ${blockedEnd.toISOString().split('T')[0]}`);
                }
            });

            if (conflictingBlockedDates.length > 0) {
                return response.error400(res, "Cabin is not available for the requested dates ", {
                    cabinId: cabin._id,
                    cabinName: cabin.name,
                    requestedDates: {
                        checkInDate: checkInDate,
                        checkOutDate: checkOutDate
                    },
                    conflictingBlockedDates: conflictingBlockedDates,
                    message: `Cabin has ${conflictingBlockedDates.length} blocked date range(s) that conflict with your requested dates`
                });
            }
        }

        // Get date-only values for initial filtering
        const checkInDateOnly = new Date(checkIn);
        checkInDateOnly.setHours(0, 0, 0, 0);
        const checkOutDateOnly = new Date(checkOut);
        checkOutDateOnly.setHours(0, 0, 0, 0);
        
        // Find all bookings that might overlap (using date comparisons)
        const allPotentialBookings = await Booking.find({
            cabinId: cabinId,
            isDeleted: { $ne: true },
            paymentStatus: 'paid',
            status: { $ne: "Cancelled" },
            $and: [
                { checkInDate: { $lte: new Date(checkOutDateOnly.getTime() + 24 * 60 * 60 * 1000 - 1) } },
                { checkOutDate: { $gte: checkInDateOnly } }
            ]
        });
        
        // Normalize booking dates and check for actual overlaps
        const overlappingBooking = allPotentialBookings.find(booking => {
          // Normalize booking dates: check-in at 2 PM, checkout at 11 AM
          const bookingCheckIn = new Date(booking.checkInDate);
          bookingCheckIn.setHours(14, 0, 0, 0);
          
          const bookingCheckOut = new Date(booking.checkOutDate);
          bookingCheckOut.setHours(11, 0, 0, 0);
          
          // Two date ranges overlap if: start1 < end2 AND end1 > start2
          const overlaps = (checkInDateTime < bookingCheckOut && checkOutDateTime > bookingCheckIn);
          
          return overlaps;
        });

        if (overlappingBooking) {
            return response.error400(res, "Cabin is already booked for these dates. Please choose different dates.");
        }

        const requestedAdults = parseInt(adults) || 0;
        const requestedChildren = parseInt(children) || 0;

        if (requestedAdults > cabin.adultCapacity) {
            return response.error400(res, `Cabin can only accommodate ${cabin.adultCapacity} adults. You requested ${requestedAdults} adults.`);
        }

        if (requestedChildren > cabin.childCapacity) {
            return response.error400(res, `Cabin can only accommodate ${cabin.childCapacity} children. You requested ${requestedChildren} children.`);
        }

        // Validate package array if provided (optional - not mandatory)
        let validatedPackages = [];
        
        if (packageArray && Array.isArray(packageArray) && packageArray.length > 0) {
            // Validate each package in the array
            for (let i = 0; i < packageArray.length; i++) {
                const pkg = packageArray[i];
                
                // Validate required fields
                if (!pkg.packageId) {
                    return response.error400(res, `Package at index ${i} is missing packageId`);
                }
                
                if (pkg.type === undefined || pkg.type === null) {
                    return response.error400(res, `Package at index ${i} is missing type (0 = per person, 1 = per couple)`);
                }
                
                if (pkg.type !== 0 && pkg.type !== 1) {
                    return response.error400(res, `Package at index ${i} has invalid type. Must be 0 (per person) or 1 (per couple)`);
                }
                
                if (pkg.amount === undefined || pkg.amount === null || isNaN(parseFloat(pkg.amount)) || parseFloat(pkg.amount) < 0) {
                    return response.error400(res, `Package at index ${i} has invalid amount`);
                }
                
                if (!pkg.currency) {
                    return response.error400(res, `Package at index ${i} is missing currency`);
                }
                
                // Validate package exists and is active
                const selectedPackage = await Package.findOne({ 
                    _id: pkg.packageId, 
                    isDeleted: false, 
                    isActive: true 
                });

                if (!selectedPackage) {
                    return response.error400(res, `Package at index ${i} (${pkg.packageId}) is not available`);
                }
                
                const packageType = parseInt(pkg.type);
                
                // Add validated package to array
                validatedPackages.push({
                    packageId: pkg.packageId,
                    type: packageType,
                    amount: parseFloat(pkg.amount),
                    currency: pkg.currency
                });
            }
        }
        // If no package array is provided, no package validation needed - booking can be created without package

        if (!totalAmount || isNaN(parseFloat(totalAmount)) || parseFloat(totalAmount) <= 0) {
            return response.error400(res, "Valid total amount is required");
        }

        // Validate cabin amount if provided
        if (cabinAmount !== undefined && cabinAmount !== null) {
            if (isNaN(parseFloat(cabinAmount)) || parseFloat(cabinAmount) < 0) {
                return response.error400(res, "Invalid cabin amount");
            }
        }

        // Calculate total amount: Cabin price + Package prices (if selected)
        const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        const calculatedCabinPrice = cabin.pricePerNight * nights;
        
        // Use provided cabinAmount or calculated cabin price
        const cabinPrice = cabinAmount !== undefined && cabinAmount !== null ? parseFloat(cabinAmount) : calculatedCabinPrice;
        
        // Sum all package prices if packages are selected
        let packagePrice = 0;
        if (validatedPackages.length > 0) {
            packagePrice = validatedPackages.reduce((sum, pkg) => sum + pkg.amount, 0);
        }
        
        const baseAmount = cabinPrice + packagePrice;
        const expectedAmount = baseAmount.toFixed(2);
        const frontendAmount = parseFloat(totalAmount).toFixed(2);

        if (Math.abs(parseFloat(frontendAmount) - parseFloat(expectedAmount)) > 0.01) {
            return response.error400(res, `Amount mismatch. Expected: ${currency || 'USD'} ${expectedAmount}, Received: ${currency || 'USD'} ${frontendAmount}`);
        }

        // Final check before creating booking - use normalized dates
        // Get date-only values for initial filtering
        const finalCheckInDateOnly = new Date(checkIn);
        finalCheckInDateOnly.setHours(0, 0, 0, 0);
        const finalCheckOutDateOnly = new Date(checkOut);
        finalCheckOutDateOnly.setHours(0, 0, 0, 0);
        
        // Find all bookings that might overlap (using date comparisons)
        const allFinalPotentialBookings = await Booking.find({
            cabinId: cabinId,
            isDeleted: { $ne: true },
            paymentStatus: 'paid',
            status: { $ne: "Cancelled" },
            $and: [
                { checkInDate: { $lte: new Date(finalCheckOutDateOnly.getTime() + 24 * 60 * 60 * 1000 - 1) } },
                { checkOutDate: { $gte: finalCheckInDateOnly } }
            ]
        });
        
        // Normalize booking dates and check for actual overlaps
        const finalOverlappingBooking = allFinalPotentialBookings.find(booking => {
          // Normalize booking dates: check-in at 2 PM, checkout at 11 AM
          const bookingCheckIn = new Date(booking.checkInDate);
          bookingCheckIn.setHours(14, 0, 0, 0);
          
          const bookingCheckOut = new Date(booking.checkOutDate);
          bookingCheckOut.setHours(11, 0, 0, 0);
          
          // Two date ranges overlap if: start1 < end2 AND end1 > start2
          const overlaps = (checkInDateTime < bookingCheckOut && checkOutDateTime > bookingCheckIn);
          
          return overlaps;
        });

        if (finalOverlappingBooking) {
            return response.error400(res, "Cabin is sold out for these dates. Please try different dates.");
        }

        const bookingData = {
            cabinId,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            adults: requestedAdults,
            children: requestedChildren,
            guestDetails,
            cabinPricePerNight: cabin.pricePerNight,
            totalAmount: parseFloat(frontendAmount),
            currency: currency,
            paymentMethod,
            status: 'Pending',
            paymentStatus: 'incomplete'
        };

        // Include package array only if provided (optional)
        if (validatedPackages.length > 0) {
            // Store packages as a SNAPSHOT (embedded array) - not a reference
            // This ensures historical pricing data is preserved even if package pricing changes later
            bookingData.package = validatedPackages;
        }

        const booking = new Booking(bookingData);
        const savedBooking = await booking.save();
        let submitData = null;
        try {
            const submitUrl =  process.env.EXPRESSPAY_SUBMIT_URL;
            const submitPayload = {
                'merchant-id': process.env.EXPRESSPAY_MERCHANT_ID,
                'api-key': process.env.EXPRESSPAY_API_KEY,
                'firstname': guestDetails.firstName,
                'lastname': guestDetails.lastName,
                'email': guestDetails.email,
                'phonenumber': guestDetails.mobileNumber,
                'currency': currency,
                'amount': savedBooking.totalAmount.toFixed(2),
                'order-id': savedBooking.bookingReference,
                'order-desc': `Cabin booking ${savedBooking.bookingReference}`,
                'redirect-url': process.env.EXPRESSPAY_REDIRECT_URL,
                'post-url': (process.env.EXPRESSPAY_POST_URL || 'https://api.palmislandgh.com/api/v1/booking/expresspay/callback').trim()
            };

            // Log Submit API Request (mask sensitive api-key)
            console.log('=== ExpressPay Submit API Request ===');
            console.log('Booking Reference:', savedBooking.bookingReference);
            console.log('URL:', submitUrl);
            const logPayload = { ...submitPayload };
            if (logPayload['api-key']) {
                logPayload['api-key'] = logPayload['api-key'].substring(0, 10) + '...' + logPayload['api-key'].substring(logPayload['api-key'].length - 5);
            }
            console.log('Payload:', JSON.stringify(logPayload, null, 2));
            console.log('POST-URL Value:', submitPayload['post-url']);
            console.log('POST-URL Length:', submitPayload['post-url']?.length);
            console.log('POST-URL Starts with https:', submitPayload['post-url']?.startsWith('https://'));
            console.log('Form Body (URL Encoded):', new URLSearchParams(submitPayload).toString());
            
            // Verify post-url is in form body
            const formBodyCheck = new URLSearchParams(submitPayload).toString();
            const hasPostUrl = formBodyCheck.includes('post-url');
            console.log('POST-URL in Form Body:', hasPostUrl);
            if (hasPostUrl) {
                const postUrlMatch = formBodyCheck.match(/post-url=([^&]+)/);
                console.log('POST-URL from Form Body:', postUrlMatch ? decodeURIComponent(postUrlMatch[1]) : 'NOT FOUND');
            }

            const formBody = new URLSearchParams();
            for (const [key, value] of Object.entries(submitPayload)) {
                if (value !== undefined && value !== null) {
                    formBody.append(key, String(value));
                }
            }

            const submitResponse = await fetch(submitUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formBody.toString()
            });

            console.log('=== ExpressPay Submit API Response ===');
            console.log('Status Code:', submitResponse.status);
            console.log('Response Headers:', Object.fromEntries(submitResponse.headers.entries()));

            submitData = await submitResponse.json();
            console.log('Response Body:', JSON.stringify(submitData, null, 2));

            if (submitData && submitData.status === 1 && submitData.token) {
                console.log('✅ ExpressPay Submit Success - Token received:', submitData.token);
                savedBooking.paymentToken = submitData.token;
                savedBooking.paymentResponse = submitData;
                await savedBooking.save();
            } else {
                console.error('❌ ExpressPay Submit Error - Status:', submitData?.status, 'Message:', submitData?.message);
                savedBooking.paymentResponse = submitData;
                await savedBooking.save();
            }
        } catch (e) {
            console.error('❌ ExpressPay Submit Exception:', e.message);
            console.error('Error Stack:', e.stack);
        }

        await savedBooking;

        return response.success200(res, 'Booking created successfully', savedBooking.getFormattedBooking());
    } catch (error) {
        console.error(`Error creating booking: ${error.message}`);
        return response.serverError500(res, 'Error creating booking', error.message);
    }
};

// Get all bookings (admin list; optional filter: incomplete | paid | cancelled). No pagination — returns all matches.
// Query: ?filter=incomplete|paid|cancelled (also accepts legacy ?type= for same values)
const getAllBookings = async (req, res) => {
    try {
        const { filter: filterQuery, type: typeQuery } = req.query;
        const rawFilter = String(filterQuery || typeQuery || '')
            .trim()
            .toLowerCase();
        const filterKey =
            rawFilter === 'paid' || rawFilter === 'incomplete' || rawFilter === 'cancelled'
                ? rawFilter
                : 'all';

        const mongoFilter = {
            isDeleted: { $ne: true },
            ...bookingAdminListMongo
        };

        if (filterKey === 'incomplete') {
            mongoFilter.paymentStatus = { $nin: ['paid', 'refunded'] };
            mongoFilter.status = { $ne: 'Cancelled' };
        } else if (filterKey === 'paid') {
            mongoFilter.paymentStatus = 'paid';
            mongoFilter.status = { $ne: 'Cancelled' };
        } else if (filterKey === 'cancelled') {
            mongoFilter.status = 'Cancelled';
        }

        const bookings = await Booking.find(mongoFilter).sort({ createdAt: -1 });

        const packageTitleMap = buildPackageTitleMapFromBookingDocs(bookings);

        const result = bookings.map((b) =>
            formatAdminBookingRow(
                b,
                buildEnrichedPackageListForBooking(b, packageTitleMap)
            )
        );

        return res.status(200).json({
            success: true,
            statusCode: 200,
            message: buildFilterMessage(filterKey, result.length),
            filter: filterKey,
            total: result.length,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`Error retrieving bookings: ${error.message}`);
        return response.serverError500(res, 'Error retrieving bookings', error.message);
    }
};

/**
 * Ticket breakdown for an activity line (matches cart / Activity pricing tiers).
 * Only tiers with quantity > 0 are included.
 */
function buildActivityTicketsFromLine(act) {
    const tickets = [];
    const s = Number(act.single) || 0;
    const c = Number(act.couple) || 0;
    const g = Number(act.groupOfFour) || 0;
    const ch = Number(act.children) || 0;
    if (s > 0) tickets.push({ kind: 'per_person', label: 'Per person', quantity: s });
    if (c > 0) tickets.push({ kind: 'couple', label: '2 persons', quantity: c });
    if (g > 0) tickets.push({ kind: 'group_of_four', label: 'Group of four', quantity: g });
    if (ch > 0) tickets.push({ kind: 'children', label: 'Children', quantity: ch });
    return tickets;
}

// Activity-only bookings (admin list). Query: ?filter=paid | incomplete | cancelled
// - incomplete: payment incomplete, pending, failed, or refunded (excludes cancelled bookings)
// - paid: paymentStatus paid, not cancelled
// - cancelled: status Cancelled
// Omit filter to list all activity-only bookings (no pagination).
const getAllActivityBookings = async (req, res) => {
    try {
        const { filter: filterQuery, type: typeQuery } = req.query;
        const mongoFilter = {
            isDeleted: { $ne: true },
            ...bookingHasActivityOnlyMongo
        };
        const filterKey = String(filterQuery || typeQuery || '')
            .trim()
            .toLowerCase();
        if (filterKey === 'incomplete' || filterKey === 'pending' || filterKey === 'open') {
            mongoFilter.paymentStatus = { $in: ['incomplete', 'pending', 'failed', 'refunded'] };
            mongoFilter.status = { $ne: 'Cancelled' };
        } else if (filterKey === 'paid') {
            mongoFilter.paymentStatus = 'paid';
            mongoFilter.status = { $ne: 'Cancelled' };
        } else if (filterKey === 'cancelled') {
            mongoFilter.status = 'Cancelled';
        }
        const bookings = await Booking.find(mongoFilter)
            .populate('activities.activityId', 'name')
            .sort({ createdAt: -1 });
        const result = bookings.map((b) => {
            const row = b.getFormattedBooking();
            row.activities = (row.activities || []).map((act) => {
                const pop = act.activityId && typeof act.activityId === 'object' ? act.activityId : null;
                const activityName = pop && pop.name ? pop.name : act.activityName || 'Activity';
                const activityId = pop && pop._id ? pop._id : act.activityId;
                return {
                    ...act,
                    activityId,
                    activityName,
                    tickets: buildActivityTicketsFromLine(act)
                };
            });
            return row;
        });
        return res.status(200).json({
            success: true,
            statusCode: 200,
            message: 'Activity bookings retrieved successfully',
            data: result,
            total: result.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`Error retrieving activity bookings: ${error.message}`);
        return response.serverError500(res, 'Error retrieving activity bookings', error.message);
    }
};

const getBookingById = async (req, res) => {
    try {
        const booking = await Booking.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
        if (!booking) {
            return response.notFound404(res, 'Booking not found');
        }
        return response.success200(res, 'Booking retrieved successfully', booking.getFormattedBooking());
    } catch (error) {
        if (error.name === 'CastError') {
            return response.error400(res, 'Invalid booking ID format');
        }
        console.error(`Error retrieving booking: ${error.message}`);
        return response.serverError500(res, 'Error retrieving booking', error.message);
    }
};

/** All rows sharing a payment reference (split cart: multiple cabins / activities). */
const getBookingByReference = async (req, res) => {
    try {
        const { reference } = req.params;
        const bookings = await Booking.find({
            bookingReference: reference,
            isDeleted: { $ne: true }
        })
            .sort({ createdAt: 1 });
        if (!bookings.length) {
            return response.notFound404(res, 'Booking not found');
        }
        return response.success200(res, 'Booking(s) retrieved successfully', {
            bookingReference: reference,
            rows: bookings.map((b) => b.getFormattedBooking())
        });
    } catch (error) {
        console.error(`Error retrieving booking by reference: ${error.message}`);
        return response.serverError500(res, 'Error retrieving booking', error.message);
    }
};

const updateBookingStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['Pending', 'Confirmed', 'Checked-In', 'Checked-Out', 'Cancelled', 'No-Show'];
        if (!status || !validStatuses.includes(status)) {
            return response.error400(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
        const booking = await Booking.findOneAndUpdate(
            { _id: req.params.id, isDeleted: { $ne: true } },
            { status },
            { new: true }
        );
        if (!booking) {
            return response.notFound404(res, 'Booking not found');
        }
        return response.success200(res, 'Booking status updated successfully', booking.getFormattedBooking());
    } catch (error) {
        if (error.name === 'CastError') {
            return response.error400(res, 'Invalid booking ID format');
        }
        console.error(`Error updating booking status: ${error.message}`);
        return response.serverError500(res, 'Error updating booking status', error.message);
    }
};

const manualConfirmBooking = async (req, res) => {
    try {
        const booking = await Booking.findOneAndUpdate(
            { _id: req.params.id, isDeleted: { $ne: true } },
            {
            status: 'Confirmed',
            paymentStatus: 'paid',
                paymentDate: new Date()
            },
            { new: true }
        );
        if (!booking) {
            return response.notFound404(res, 'Booking not found');
        }
        return response.success200(res, 'Booking confirmed manually', booking.getFormattedBooking());
    } catch (error) {
        if (error.name === 'CastError') {
            return response.error400(res, 'Invalid booking ID format');
        }
        console.error(`Error manually confirming booking: ${error.message}`);
        return response.serverError500(res, 'Error manually confirming booking', error.message);
    }
};

/** Package titles for email/detail: legacy booking.package + cart cabins[].packages */
async function loadPackageDetailsMapForBooking(booking) {
    const packageDetailsMap = new Map();
    const add = (pkg) => {
        if (!pkg?.packageId) return;
        const id = pkg.packageId.toString();
        if (!packageDetailsMap.has(id)) {
            packageDetailsMap.set(id, { _id: pkg.packageId, title: pkg.name || 'Package' });
        }
    };
    (booking.package || []).forEach(add);
    (booking.cabins || []).forEach((c) => (c.packages || []).forEach(add));
    return packageDetailsMap;
}

// Cancel a booking
const cancelBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const { cancellationReason, cancellationFee = 0 } = req.body;

        const booking = await Booking.findOneAndUpdate(
            { _id: id },
            {
                status: 'Cancelled',
                cancellationReason,
                cancellationFee,
                cancelledAt: new Date()
            },
            { new: true }
        );

        if (!booking) {
            return response.notFound404(res, 'Booking not found');
        }

        const packageDetailsMap = await loadPackageDetailsMapForBooking(booking);

        try {
            const guestEmail = booking.guestDetails?.email;
            if (guestEmail) {
                await sendCancellationEmail(booking, packageDetailsMap);
                console.log(`Cancellation email sent to: ${guestEmail}`);
            }
        } catch (emailError) {
            console.error('Failed to send cancellation email:', emailError);
        }

        console.log(`Booking cancelled: ${booking.bookingReference}`);
        return response.success200(res, 'Booking cancelled successfully', booking.getFormattedBooking());
    } catch (error) {
        console.error(`Error cancelling booking: ${error.message}`);
        return response.serverError500(res, 'Error cancelling booking', error.message);
    }
};

// Get all bookings for a specific cabin
const getBookingsByCabin = async (req, res) => {
    try {
        const { cabinId } = req.params;
        const { startDate, endDate } = req.query;

        // Only paid + confirmed; legacy cabinId and cart cabins[]; exclude activity-only rows
        const filter = {
            isDeleted: { $ne: true },
            paymentStatus: 'paid',
            status: 'Confirmed',
            $and: [
                bookingHasCabinStayMongo,
                { $or: [{ cabinId }, { 'cabins.cabinId': cabinId }] }
            ]
        };

        if (startDate && endDate) {
            filter.checkInDate = { $gte: new Date(startDate) };
            filter.checkOutDate = { $lte: new Date(endDate) };
        }

        const bookings = await Booking.find(filter)
            .sort({ checkInDate: 1 });

        // Get package titles
        const packageIds = [...new Set(bookings.flatMap(b => 
            (b.package || []).map(p => p.packageId?.toString()).filter(Boolean)
        ))];
        const packages = packageIds.length > 0 
            ? await Package.find({ _id: { $in: packageIds } }).select('_id title')
            : [];
        const titleMap = new Map(packages.map(p => [p._id.toString(), p.title]));

        // Add title to packages
        const result = bookings.map(booking => {
            const formatted = booking.getFormattedBooking();
            if (formatted.package && Array.isArray(formatted.package)) {
                formatted.package = formatted.package.map(pkg => ({
                    packageId: pkg.packageId,
                    type: pkg.type,
                    amount: pkg.amount,
                    currency: pkg.currency,
                    _id: pkg._id,
                    title: titleMap.get(pkg.packageId?.toString()) || null
                }));
            }
            return formatted;
        });

        console.log(`Retrieved ${bookings.length} confirmed paid booking(s) for cabin ${cabinId}`);
        return response.success200(res, "Cabin bookings retrieved successfully", result);
    } catch (error) {
        console.error(`Error retrieving cabin bookings: ${error.message}`);
        return response.serverError500(res, "Error retrieving cabin bookings", error.message);
    }
};

// Get bookings where a date falls between check-in and check-out dates
// Get bookings for a specific date
const getBookingsByDates = async (req, res) => {
    try {
        // Get date from query or body
        const date = req.query.date || req.body.date;

        // Validate required parameter
        if (!date) {
            return response.error400(res, "Date is required (use 'date' parameter in query or body)");
        }

        // Parse and validate date
        const searchDate = new Date(date);

        // Validate date is valid
        if (isNaN(searchDate.getTime())) {
            return response.error400(res, "Invalid date format");
        }

        // Normalize date to start of day for comparison
        const normalizedDate = new Date(searchDate);
        normalizedDate.setHours(0, 0, 0, 0);

        const bookings = await Booking.find({
            isDeleted: { $ne: true },
            paymentStatus: 'paid', // Only fetch paid bookings
            status: { $ne: 'Cancelled' }, // Exclude cancelled bookings
            $and: [
                { checkInDate: { $lte: normalizedDate } }, // Check-in date is on or before the search date
                { checkOutDate: { $gt: normalizedDate } }, // Check-out date is after the search date
                bookingHasCabinStayMongo
            ]
        })
            .populate({
                path: 'cabinId',
                select: 'name cabinType pricePerNight currency'
            })
            .sort({ checkInDate: 1 });

        // Get package titles
        const packageIds = [...new Set(bookings.flatMap(b => 
            (b.package || []).map(p => p.packageId?.toString()).filter(Boolean)
        ))];
        const packages = packageIds.length > 0 
            ? await Package.find({ _id: { $in: packageIds } }).select('_id title')
            : [];
        const titleMap = new Map(packages.map(p => [p._id.toString(), p.title]));

        // Add title to packages
        const result = bookings.map(booking => {
            const formatted = booking.getFormattedBooking();
            if (formatted.package && Array.isArray(formatted.package)) {
                formatted.package = formatted.package.map(pkg => ({
                    packageId: pkg.packageId,
                    type: pkg.type,
                    amount: pkg.amount,
                    currency: pkg.currency,
                    _id: pkg._id,
                    title: titleMap.get(pkg.packageId?.toString()) || null
                }));
            }
            return formatted;
        });

        console.log(`Retrieved ${bookings.length} paid bookings for date: ${date}`);
        return response.success200(res, "Bookings retrieved successfully", result);
    } catch (error) {
        console.error(`Error retrieving bookings by date: ${error.message}`);
        return response.serverError500(res, "Error retrieving bookings by date", error.message);
    }
};

// Get booking statistics and analytics
const getBookingStatistics = async (req, res) => {
    try {
        const totalBookings = await Booking.countDocuments({ isDeleted: false });
        
        const statusStats = await Booking.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: null,
                    totalBookings: { $sum: 1 },
                    pendingBookings: {
                        $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] }
                    },
                    confirmedBookings: {
                        $sum: { $cond: [{ $eq: ['$status', 'Confirmed'] }, 1, 0] }
                    },
                    checkedInBookings: {
                        $sum: { $cond: [{ $eq: ['$status', 'Checked-In'] }, 1, 0] }
                    },
                    checkedOutBookings: {
                        $sum: { $cond: [{ $eq: ['$status', 'Checked-Out'] }, 1, 0] }
                    },
                    cancelledBookings: {
                        $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] }
                    },
                    totalRevenue: { $sum: '$totalAmount' },
                    averageBookingValue: { $avg: '$totalAmount' }
                }
            }
        ]);

        const paymentStats = await Booking.aggregate([
            { $match: { isDeleted: false } },
            {
                $group: {
                    _id: '$paymentStatus',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' }
                }
            }
        ]);

        const result = {
            totalBookings,
            statusBreakdown: statusStats[0] || {},
            paymentBreakdown: paymentStats
        };

        console.log("Booking statistics retrieved");
        return response.success200(res, "Booking statistics retrieved successfully", result);
    } catch (error) {
        console.error(`Error retrieving booking statistics: ${error.message}`);
        return response.serverError500(res, "Error retrieving booking statistics", error.message);
    }
};

// Check cabin availability for given dates
const checkCabinAvailability = async (req, res) => {
    try {
        const { cabinId } = req.params;
        const { checkInDate, checkOutDate } = req.query;

        if (!checkInDate || !checkOutDate) {
            return response.error400(res, "Check-in and check-out dates are required");
        }

        const checkIn = new Date(checkInDate);
        const checkOut = new Date(checkOutDate);

        if (checkIn >= checkOut) {
            return response.error400(res, "Check-out date must be after check-in date");
        }

        // Normalize dates: check-in at 2 PM (14:00), checkout at 11 AM (11:00)
        // This allows same-day transitions (checkout morning, check-in afternoon)
        const requestCheckIn = new Date(checkIn);
        requestCheckIn.setHours(14, 0, 0, 0); // Check-in at 2 PM
        
        const requestCheckOut = new Date(checkOut);
        requestCheckOut.setHours(11, 0, 0, 0); // Checkout at 11 AM
        
        // Get date-only values for initial filtering
        const checkInDateOnly = new Date(checkIn);
        checkInDateOnly.setHours(0, 0, 0, 0);
        const checkOutDateOnly = new Date(checkOut);
        checkOutDateOnly.setHours(0, 0, 0, 0);

        // Find all bookings that might overlap (using date comparisons)
        const allPotentialBookings = await Booking.find({
            cabinId: cabinId,
            isDeleted: false,
            paymentStatus: 'paid',
            status: { $ne: "Cancelled" },
            $and: [
                { checkInDate: { $lte: new Date(checkOutDateOnly.getTime() + 24 * 60 * 60 * 1000 - 1) } },
                { checkOutDate: { $gte: checkInDateOnly } }
            ]
        });
        
        // Normalize booking dates and check for actual overlaps
        const existingBooking = allPotentialBookings.find(booking => {
          // Normalize booking dates: check-in at 2 PM, checkout at 11 AM
          const bookingCheckIn = new Date(booking.checkInDate);
          bookingCheckIn.setHours(14, 0, 0, 0);
          
          const bookingCheckOut = new Date(booking.checkOutDate);
          bookingCheckOut.setHours(11, 0, 0, 0);
          
          // Two date ranges overlap if: start1 < end2 AND end1 > start2
          const overlaps = (requestCheckIn < bookingCheckOut && requestCheckOut > bookingCheckIn);
          
          return overlaps;
        });

        const isAvailable = !existingBooking;

        const result = {
            cabinId,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            isAvailable,
            conflictingBooking: existingBooking ? {
                bookingReference: existingBooking.bookingReference,
                checkInDate: existingBooking.checkInDate,
                checkOutDate: existingBooking.checkOutDate,
                status: existingBooking.status
            } : null
        };

        console.log(`Cabin availability checked: ${cabinId} - ${isAvailable ? 'Available' : 'Not Available'}`);
        return response.success200(res, "Cabin availability checked successfully", result);
    } catch (error) {
        console.error(`Error checking cabin availability: ${error.message}`);
        return response.serverError500(res, "Error checking cabin availability", error.message);
    }
};

// ===========================================
// ExpressPay Server-to-Server Callback Handler (POST URL)
// Handles webhook callback from ExpressPay when payment status changes
// ===========================================
const handleExpressPayCallback = async (req, res) => {
    try {
        // Receive order-id, token, and merchant-id from ExpressPay POST request query parameters
        const order_id = req.query['order-id'];
        const token = req.query.token;
        const merchant_id = req.query['merchant-id'];
        
        console.log('=== ExpressPay Callback Received (Server-to-Server) ===');
        console.log('Order ID:', order_id);
        console.log('Token:', token);
        console.log('Merchant ID:', merchant_id);
        console.log('All Query Params:', JSON.stringify(req.query, null, 2));
        
        if (!order_id || !token) {
            console.error('❌ Missing order-id or token in callback');
            // Return 200 OK to ExpressPay even if validation fails
            return res.status(200).json({ status: 'error', message: 'Missing required parameters' });
        }

        // Find booking by bookingReference (order_id from ExpressPay)
        const booking = await Booking.findOne({ 
            bookingReference: order_id,
            isDeleted: { $ne: true }
        });

        if (!booking) {
            console.error(`❌ Booking not found for order_id: ${order_id}`);
            // Return 200 OK to ExpressPay even if booking not found
            return res.status(200).json({ status: 'error', message: 'Booking not found' });
        }

        // Store original payment status to check if it changed
        const originalPaymentStatus = booking.paymentStatus;
        const originalStatus = booking.status;

        // Step 4(A): Query ExpressPay to check payment status
        const queryUrl = process.env.EXPRESSPAY_QUERY_URL;
        const queryPayload = {
            'merchant-id': process.env.EXPRESSPAY_MERCHANT_ID,
            'api-key': process.env.EXPRESSPAY_API_KEY,
            'token': token
        };

        const formBody = new URLSearchParams();
        for (const [key, value] of Object.entries(queryPayload)) {
            if (value !== undefined && value !== null) {
                formBody.append(key, String(value));
            }
        }

        const queryResponse = await fetch(queryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody.toString()
        });

        const queryData = await queryResponse.json();
        console.log('=== Step 4(A) Query API Response ===');
        console.log('Query Response:', JSON.stringify(queryData, null, 2));

        let updateData = {
            paymentResponse: queryData,
            updatedAt: new Date()
        };

        // Handle all result codes from Query API
        if (queryData.result === 1) {
            // 1 = Approved - Payment confirmed
            updateData.paymentStatus = 'paid';
            updateData.status = 'Confirmed';
            updateData.transactionId = queryData['transaction-id'] || queryData.transaction_id;
            updateData.paymentDate = new Date();
            console.log(`✅ Payment approved for booking ${order_id} - Status updated to 'paid' and 'Confirmed'`);
        } else if (queryData.result === 2) {
            // 2 = Declined
            updateData.paymentStatus = 'Declined';
            console.log(`❌ Payment declined for booking ${order_id} - Status updated to 'Declined'`);
        } else if (queryData.result === 3) {
            // 3 = Error
            updateData.paymentStatus = 'failed';
            console.log(`❌ System error for booking ${order_id} - Status updated to 'failed'`);
        } else if (queryData.result === 4) {
            // 4 = Pending (still processing)
            updateData.paymentStatus = 'pending';
            console.log(`⏳ Payment still pending for booking ${order_id} - Status remains 'pending'`);
        } else {
            // Unknown result code
            updateData.paymentStatus = 'incomplete';
            console.log(`⚠️ Unknown result code ${queryData.result} for booking ${order_id} - Status updated to 'incomplete'`);
        }

        // Update booking with payment status
        const updatedBooking = await Booking.findByIdAndUpdate(
            booking._id, 
            updateData,
            { new: true } // Return updated document
        );

        if (!updatedBooking) {
            console.error(`❌ Failed to update booking ${order_id}`);
            return res.status(200).json({ status: 'error', message: 'Failed to update booking' });
        }

        console.log(`💾 Payment status saved successfully: ${updateData.paymentStatus} for booking ${order_id}`);

        // Populate cabin details for email
        await updatedBooking;
        
        // Populate package details if package array exists
        let packageDetailsMap = new Map();
        if (updatedBooking.package && Array.isArray(updatedBooking.package) && updatedBooking.package.length > 0) {
            // Get unique package IDs
            const uniquePackageIds = [...new Set(updatedBooking.package.map(p => p.packageId.toString()))];
            // Fetch all packages
            const packages = await Package.find({ _id: { $in: uniquePackageIds } });
            // Create a map for quick lookup
            packages.forEach(pkg => {
                packageDetailsMap.set(pkg._id.toString(), pkg);
            });
        }

        // Send confirmation email only if payment status CHANGED to 'paid' AND status CHANGED to 'Confirmed' (not already paid and confirmed)
        // This prevents duplicate emails if both redirect and callback are triggered
        const paymentStatusChanged = originalPaymentStatus !== 'paid' && updateData.paymentStatus === 'paid';
        const statusChanged = originalStatus !== 'Confirmed' && updateData.status === 'Confirmed';
        if (paymentStatusChanged && statusChanged && updatedBooking.guestDetails?.email) {
            try {
                const guestEmail = updatedBooking.guestDetails.email;
                const emailSubject = `Booking Confirmation - Reference: ${updatedBooking.bookingReference}`;
                
                // Format dates with day name and time
                const checkInDateObj = new Date(updatedBooking.checkInDate);
                const checkOutDateObj = new Date(updatedBooking.checkOutDate);
                
                const checkInDate = checkInDateObj.toLocaleDateString('en-US', { 
                    weekday: 'short',
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                }) + ' after 2 PM';
                
                const checkOutDate = checkOutDateObj.toLocaleDateString('en-US', { 
                    weekday: 'short',
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                }) + ' before 11:00 AM';
                
                // Calculate number of nights
                const nights = Math.ceil((checkOutDateObj - checkInDateObj) / (1000 * 60 * 60 * 24));
                
                // Format guests
                const adults = updatedBooking.adults || 0;
                const children = updatedBooking.children || 0;
                const guestsText = `${adults} adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} child${children !== 1 ? 'ren' : ''}` : ''}`;
                
                // Format booked by name
                const bookedBy = `${updatedBooking.guestDetails?.firstName || ''} ${updatedBooking.guestDetails?.lastName || ''}`.trim() || 'Guest';
                
                // Format amount
                const currencySymbol = updatedBooking.currency === 'USD' ? 'USD $' : updatedBooking.currency === 'GHS' ? 'GHS ₵' : (updatedBooking.currency || 'GHS') + ' ';
                const amountPaid = `${currencySymbol}${updatedBooking.totalAmount?.toLocaleString() || '0.00'}`;

                const emailMessage = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <!--[if mso]>
                        <style type="text/css">
                            body, table, td {font-family: Arial, sans-serif !important;}
                        </style>
                        <![endif]-->
                        <style>
                            * {
                                -webkit-text-size-adjust: 100%;
                                -ms-text-size-adjust: 100%;
                            }
                            body {
                                margin: 0 !important;
                                padding: 0 !important;
                                background-color: #f0f4f8;
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif;
                                line-height: 1.6;
                                color: #333;
                            }
                            table {
                                border-collapse: collapse;
                                mso-table-lspace: 0pt;
                                mso-table-rspace: 0pt;
                            }
                            img {
                                border: 0;
                                height: auto;
                                line-height: 100%;
                                outline: none;
                                text-decoration: none;
                                -ms-interpolation-mode: bicubic;
                                max-width: 100%;
                            }
                            .main-container {
                                max-width: 650px;
                                width: 100%;
                                margin: 0 auto;
                                background-color: #ffffff;
                            }
                            .header {
                                background-color: #133730;
                                padding: 25px 20px;
                                text-align: center;
                            }
                            .content-wrapper {
                                padding: 30px 25px;
                                background-color: #ffffff;
                            }
                            .confirmation-box {
                                background-color: #e8f5e9;
                                border: 2px solid #133730;
                                padding: 25px 20px;
                                margin-bottom: 25px;
                                text-align: center;
                            }
                            .confirmation-title {
                                font-size: 22px;
                                font-weight: bold;
                                color: #133730;
                                margin: 0 0 12px 0;
                                line-height: 1.3;
                            }
                            .confirmation-text {
                                font-size: 15px;
                                color: #2d5a3d;
                                line-height: 1.7;
                                margin: 0;
                            }
                            .info-box {
                                background-color: #f8f9fa;
                                border: 2px solid #e9ecef;
                                padding: 20px;
                                margin-bottom: 20px;
                            }
                            .info-box-title {
                                font-size: 17px;
                                font-weight: bold;
                                color: #133730;
                                margin: 0 0 15px 0;
                                padding-bottom: 10px;
                                border-bottom: 2px solid #133730;
                                line-height: 1.4;
                            }
                            .contact-info-box {
                                background-color: #ffffff;
                                border: 1px solid #d0d7de;
                                padding: 15px;
                                margin-top: 10px;
                            }
                            .contact-item {
                                margin: 10px 0;
                                color: #333;
                                font-size: 14px;
                                line-height: 1.6;
                            }
                            .contact-icon {
                                display: inline-block;
                                width: 24px;
                                font-size: 16px;
                                vertical-align: middle;
                            }
                            .contact-text {
                                display: inline-block;
                                vertical-align: middle;
                                width: calc(100% - 30px);
                                word-wrap: break-word;
                            }
                            .booking-details-box {
                                background-color: #ffffff;
                                border: 2px solid #133730;
                                padding: 15px;
                                margin-top: 10px;
                            }
                            .detail-item {
                                background-color: #f8f9fa;
                                border-left: 4px solid #133730;
                                padding: 12px 15px;
                                margin-bottom: 10px;
                            }
                            .detail-item:last-child {
                                margin-bottom: 0;
                            }
                            .detail-label {
                                font-weight: 600;
                                color: #555;
                                font-size: 13px;
                                display: block;
                                margin-bottom: 5px;
                                line-height: 1.4;
                            }
                            .detail-value {
                                color: #133730;
                                font-size: 14px;
                                font-weight: 600;
                                display: block;
                                word-wrap: break-word;
                                line-height: 1.5;
                            }
                            .policies-box {
                                background-color: #fff9e6;
                                border: 2px solid #ffd700;
                                padding: 20px;
                                margin-top: 10px;
                            }
                            .policy-item {
                                background-color: #ffffff;
                                border-left: 3px solid #ffd700;
                                padding: 15px;
                                margin-bottom: 12px;
                            }
                            .policy-item:last-child {
                                margin-bottom: 0;
                            }
                            .policy-title {
                                font-weight: bold;
                                color: #133730;
                                font-size: 14px;
                                margin: 0 0 8px 0;
                                line-height: 1.4;
                            }
                            .policy-text {
                                color: #555;
                                font-size: 13px;
                                line-height: 1.6;
                                margin: 0;
                            }
                            .directions-box {
                                background-color: #e8f4f8;
                                border: 2px solid #4a90a4;
                                padding: 20px;
                                margin-top: 10px;
                            }
                            .direction-step {
                                background-color: #ffffff;
                                border-left: 3px solid #4a90a4;
                                padding: 12px 15px;
                                margin-bottom: 10px;
                                color: #555;
                                font-size: 13px;
                                line-height: 1.6;
                            }
                            .direction-step:last-child {
                                margin-bottom: 0;
                            }
                            .direction-icon {
                                margin-right: 8px;
                                font-size: 14px;
                            }
                            .closing-message {
                                background-color: #f8f9fa;
                                border-top: 3px solid #133730;
                                padding: 25px 20px;
                                margin-top: 25px;
                            }
                            .closing-text {
                                font-size: 14px;
                                line-height: 1.7;
                                color: #333;
                                margin: 0 0 12px 0;
                            }
                            .signature {
                                font-size: 15px;
                                color: #133730;
                                margin-top: 15px;
                            }
                            .signature-name {
                                font-weight: bold;
                                font-size: 16px;
                            }
                            .footer {
                                background-color: #133730;
                                color: #ffffff;
                                text-align: center;
                                padding: 20px;
                                font-size: 11px;
                                line-height: 1.6;
                            }
                            .footer p {
                                margin: 5px 0;
                                color: #e0e0e0;
                            }
                            @media only screen and (max-width: 600px) {
                                .main-container {
                                    width: 100% !important;
                                    max-width: 100% !important;
                                }
                                .content-wrapper {
                                    padding: 20px 15px !important;
                                }
                                .header {
                                    padding: 20px 15px !important;
                                }
                                .confirmation-box {
                                    padding: 20px 15px !important;
                                    margin-bottom: 20px !important;
                                }
                                .confirmation-title {
                                    font-size: 20px !important;
                                }
                                .confirmation-text {
                                    font-size: 14px !important;
                                }
                                .info-box {
                                    padding: 15px !important;
                                    margin-bottom: 15px !important;
                                }
                                .info-box-title {
                                    font-size: 16px !important;
                                    margin-bottom: 12px !important;
                                }
                                .contact-info-box, .booking-details-box, .policies-box, .directions-box {
                                    padding: 12px !important;
                                }
                                .detail-item {
                                    padding: 10px 12px !important;
                                    margin-bottom: 8px !important;
                                }
                                .detail-label {
                                    font-size: 12px !important;
                                    margin-bottom: 4px !important;
                                }
                                .detail-value {
                                    font-size: 13px !important;
                                }
                                .policy-item {
                                    padding: 12px !important;
                                    margin-bottom: 10px !important;
                                }
                                .policy-title {
                                    font-size: 13px !important;
                                }
                                .policy-text {
                                    font-size: 12px !important;
                                }
                                .direction-step {
                                    padding: 10px 12px !important;
                                    margin-bottom: 8px !important;
                                    font-size: 12px !important;
                                }
                                .closing-message {
                                    padding: 20px 15px !important;
                                }
                                .closing-text {
                                    font-size: 13px !important;
                                }
                                .contact-item {
                                    font-size: 13px !important;
                                }
                                .footer {
                                    padding: 15px !important;
                                    font-size: 10px !important;
                                }
                            }
                            @media only screen and (max-width: 480px) {
                                .content-wrapper {
                                    padding: 15px 12px !important;
                                }
                                .header {
                                    padding: 18px 12px !important;
                                }
                                .confirmation-title {
                                    font-size: 18px !important;
                                }
                                .confirmation-text {
                                    font-size: 13px !important;
                                }
                                .info-box {
                                    padding: 12px !important;
                                }
                                .info-box-title {
                                    font-size: 15px !important;
                                }
                                .contact-info-box, .booking-details-box, .policies-box, .directions-box {
                                    padding: 10px !important;
                                }
                                .detail-item {
                                    padding: 8px 10px !important;
                                }
                                .detail-label {
                                    font-size: 11px !important;
                                }
                                .detail-value {
                                    font-size: 12px !important;
                                }
                                .policy-item {
                                    padding: 10px !important;
                                }
                                .policy-title {
                                    font-size: 12px !important;
                                }
                                .policy-text {
                                    font-size: 11px !important;
                                }
                                .direction-step {
                                    padding: 8px 10px !important;
                                    font-size: 11px !important;
                                }
                            }
                        </style>
                    </head>
                    <body style="margin: 0; padding: 0; background-color: #f0f4f8;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0f4f8;">
                            <tr>
                                <td align="center" style="padding: 15px 10px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="650" class="main-container" style="max-width: 650px; width: 100%; background-color: #ffffff;">
                                        <!-- Header -->
                                        <tr>
                                            <td class="header" style="background-color: #133730; padding: 25px 20px; text-align: center;">
                                                <p style="font-size: 24px; font-weight: bold; color: #ffffff; letter-spacing: 2px; margin: 0; line-height: 1.3;">PALM ISLAND RESORT</p>
                                            </td>
                                        </tr>
                                        
                                        <!-- Content -->
                                        <tr>
                                            <td class="content-wrapper" style="padding: 30px 25px; background-color: #ffffff;">
                                                <!-- Confirmation Box -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="confirmation-box" style="background-color: #e8f5e9; border: 2px solid #133730; padding: 25px 20px; text-align: center;">
                                                            <p class="confirmation-title" style="font-size: 22px; font-weight: bold; color: #133730; margin: 0 0 12px 0; line-height: 1.3;">✓ Booking Confirmed!</p>
                                                            <p class="confirmation-text" style="font-size: 15px; color: #2d5a3d; line-height: 1.7; margin: 0;">
                                                                Hi ${bookedBy},<br><br>
                                                                Thank you for booking with us. Your reservation at Palm Island Resort has been successfully confirmed.
                                                            </p>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Contact Information -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📍 Contact Information</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="contact-info-box" style="background-color: #ffffff; border: 1px solid #d0d7de; padding: 15px;">
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">📍</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Atimpoku, Eastern Region, Ghana</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">📞</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Phone: +233 53 646 3111</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">✉️</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Email: info@palmislandgh.com</span>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Booking Details -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📋 Booking Details</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="booking-details-box" style="background-color: #ffffff; border: 2px solid #133730; padding: 15px;">
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Booking Reference:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${updatedBooking.bookingReference}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check In:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkInDate}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check Out:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkOutDate}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Room:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${updatedBooking.cabinId?.name || 'Cabin'}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Number of Nights:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${nights}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Number of Guests:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${guestsText}</span>
                                                                    </td>
                                                                </tr>
                                                                ${updatedBooking.guestDetails?.specialRequests && updatedBooking.guestDetails.specialRequests.trim() ? `
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f0e6ff; border-left: 4px solid #9b59b6; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #7d3c98; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Special Request:</span>
                                                                        <span class="detail-value" style="color: #7d3c98; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; white-space: pre-wrap; line-height: 1.5;">${updatedBooking.guestDetails.specialRequests.trim()}</span>
                                                                    </td>
                                                                </tr>
                                                                ` : ''}
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #e8f5e9; border-left: 4px solid #2c5f2d; padding: 12px 15px; margin-bottom: 0;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #2c5f2d; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Amount Paid:</span>
                                                                        <span class="detail-value" style="color: #2c5f2d; font-size: 15px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${amountPaid}</span>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                ${updatedBooking.package && Array.isArray(updatedBooking.package) && updatedBooking.package.length > 0 ? `
                                                <!-- Package Details -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">🎁 Selected Packages</p>
                                                            ${updatedBooking.package.map((pkg, index) => {
                                                                const packageDetails = packageDetailsMap.get(pkg.packageId.toString());
                                                                const typeLabel = pkg.type === 1 ? 'Per Couple' : 'Per Person';
                                                                return `
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="booking-details-box" style="background-color: #ffffff; border: 2px solid #133730; padding: 15px; margin-bottom: ${index < updatedBooking.package.length - 1 ? '15px' : '0'};">
                                                                    <tr>
                                                                        <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Package Name:</span>
                                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${packageDetails?.title || 'N/A'}</span>
                                                                        </td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td class="detail-item" style="background-color: #e8f5e9; border-left: 4px solid #2c5f2d; padding: 12px 15px; margin-bottom: 0;">
                                                                            <span class="detail-value" style="color: #2c5f2d; font-size: 15px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">
                                                                                ${pkg.currency || 'GHC'} ${pkg.amount?.toLocaleString() || '0.00'}
                                                                            </span>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                                `;
                                                            }).join('')}
                                                        </td>
                                                    </tr>
                                                </table>
                                                ` : ''}

                                                <!-- Resort Policies -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📜 Resort Policies</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="policies-box" style="background-color: #fff9e6; border: 2px solid #ffd700; padding: 20px;">
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 12px;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">1. Check-In & Check-Out</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Check-in: 2:00 PM | Check-out: 11:00 AM.<br>
                                                                            Early check-in or late check-out may be available upon request and subject to a small additional fee.<br>
                                                                            Please present a valid photo ID at check-in.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 12px;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">2. Bookings & Payments</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Reservations are confirmed once full payment is received.<br>
                                                                            We accept mobile money, debit/credit cards, bank transfers, and approved online payment platforms.<br>
                                                                            All prices include applicable taxes and service charges unless stated otherwise.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 0;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">3. Cancellations & Refunds</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Cancel 7 days or more before your stay for a full refund.<br>
                                                                            Cancel 1–6 days before arrival for a 50% refund.<br>
                                                                            Same-day cancellations or no-shows are non-refundable.<br>
                                                                            Refunds are processed within 7 working days.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Directions -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">🗺️ Directions to Palm Island Resort</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="directions-box" style="background-color: #e8f4f8; border: 2px solid #4a90a4; padding: 20px;">
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🛣️</span>Take the N2/Akosombo Road towards Atimpoku (about 1 hour 15 minutes).
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">➡️</span>After passing Royal Senchi Hotel, turn right at the Royal Senchi junction.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🚗</span>Continue straight, following signs toward Sajuna Beach and JamRock Restaurant.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🏷️</span>Watch for Palm Island Resort signs leading to our secured riverside car park.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 0; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">⛴️</span>Park and ride our complimentary boat to the island — your tropical escape begins here!
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Closing Message -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="closing-message" style="background-color: #f8f9fa; border-top: 3px solid #133730; padding: 25px 20px; margin-top: 25px;">
                                                            <p class="closing-text" style="font-size: 14px; line-height: 1.7; color: #333; margin: 0 0 12px 0;">
                                                                We are thrilled to have you as our guest and look forward to providing you with an unforgettable experience at Palm Island Resort. Our team is committed to ensuring your stay is comfortable, relaxing, and memorable.
                                                            </p>
                                                            <p class="closing-text" style="font-size: 14px; line-height: 1.7; color: #333; margin: 0 0 12px 0;">
                                                                If you have any questions or special requests before your arrival, please don't hesitate to reach out to us. We're here to make your stay exceptional.
                                                            </p>
                                                            <p class="signature" style="font-size: 15px; color: #133730; margin: 15px 0 0 0;">
                                                                Warm regards,<br>
                                                                <span class="signature-name" style="font-weight: bold; font-size: 16px;">Palm Island Resort Team</span>
                                                            </p>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                        
                                        <!-- Footer -->
                                        <tr>
                                            <td class="footer" style="background-color: #133730; color: #ffffff; text-align: center; padding: 20px; font-size: 11px; line-height: 1.6;">
                                                <p style="margin: 5px 0; color: #e0e0e0;">This is an automated email. Please do not reply to this message.</p>
                                                <p style="margin: 5px 0; color: #e0e0e0;">&copy; ${new Date().getFullYear()} Palm Island Resort. All rights reserved.</p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `;

                await sendEmail({
                    to: guestEmail,
                    subject: emailSubject,
                    message: emailMessage,
                    bcc: 'info@palmislandgh.com'
                });

                console.log(`✅ Confirmation email sent to: ${guestEmail} for booking ${updatedBooking.bookingReference}`);
            } catch (emailError) {
                // Log email error but don't fail the callback
                console.error('Failed to send confirmation email:', emailError);
            }
        }

        // Always return 200 OK to ExpressPay (even if processing had errors)
        // This prevents ExpressPay from retrying the callback
        return res.status(200).json({ 
            status: 'success', 
            message: 'Callback processed successfully',
            bookingReference: updatedBooking.bookingReference,
            paymentStatus: updateData.paymentStatus
        });
    } catch (error) {
        console.error('❌ ExpressPay Callback Error:', error);
        // Always return 200 OK to ExpressPay even on error
        // Log the error for debugging but don't fail the callback
        return res.status(200).json({ 
            status: 'error', 
            message: 'Callback received but processing failed',
            error: error.message 
        });
    }
};

// EXPRESSPAY INTEGRATION COMMENTED OUT - PAYMENT STATUS CHECK DISABLED
/*
// Manual payment status check endpoint
// Check payment status for a booking
const checkPaymentStatus = async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        const booking = await Booking.findOne({ _id: bookingId, isDeleted: false });
        if (!booking) {
            return response.notFound404(res, "Booking not found");
        }

        if (booking.paymentStatus === 'paid') {
            return response.success200(res, "Payment already confirmed", {
                paymentStatus: booking.paymentStatus,
                transactionId: booking.transactionId,
                paymentDate: booking.paymentDate
            });
        }

        if (booking.paymentStatus === 'pending' && booking.orderId && booking.paymentToken) {
            const queryResult = await queryExpressPayTransaction(booking.orderId, booking.paymentToken);
            
            if (queryResult.status === 'success') {
                // Update booking with payment confirmation
                await Booking.findByIdAndUpdate(bookingId, {
                    paymentStatus: 'paid',
                    transactionId: queryResult.transaction_id,
                    paymentDate: new Date(),
                    paymentResponse: queryResult
                });
                
                return response.success200(res, "Payment confirmed", {
                    paymentStatus: 'paid',
                    transactionId: queryResult.transaction_id,
                    paymentDate: new Date()
                });
            } else {
                return response.success200(res, "Payment status checked", {
                    paymentStatus: booking.paymentStatus,
                    message: queryResult.message
                });
            }
        }

        return response.success200(res, "Payment status checked", {
            paymentStatus: booking.paymentStatus
        });
    } catch (error) {
        console.error(`Error checking payment status: ${error.message}`);
        return response.serverError500(res, "Error checking payment status", error.message);
    }
};
*/

// Confirm booking after payment (Step 3 redirect + Step 4a query)
// Confirm booking after payment verification
const confirmBooking = async (req, res) => {
    try {
        // Step 3: Receive order-id and token from ExpressPay redirect
        const { 'order-id': orderId, token } = req.query;

        if (!orderId || !token) {
            return response.error400(res, "Order ID and token are required");
        }

        // Find booking by bookingReference (order-id)
        const booking = await Booking.findOne({ 
            bookingReference: orderId,
            isDeleted: { $ne: true }
        });

        if (!booking) {
            return response.notFound404(res, "Booking not found");
        }

        // Store original payment status to check if it changed
        const originalPaymentStatus = booking.paymentStatus;
        const originalStatus = booking.status;

        // Step 4a: Query ExpressPay to check payment status
        const queryUrl = process.env.EXPRESSPAY_QUERY_URL;
        const queryPayload = {
            'merchant-id': process.env.EXPRESSPAY_MERCHANT_ID,
            'api-key': process.env.EXPRESSPAY_API_KEY,
            'token': token
        };

        const formBody = new URLSearchParams();
        for (const [key, value] of Object.entries(queryPayload)) {
            if (value !== undefined && value !== null) {
                formBody.append(key, String(value));
            }
        }

        const queryResponse = await fetch(queryUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody.toString()
        });

        const queryData = await queryResponse.json();

        console.log('ExpressPay Query Response:', queryData);

        let updateData = {
            paymentResponse: queryData,
            updatedAt: new Date()
        };

        if (queryData.result === 1) {
            updateData.paymentStatus = 'paid';
            updateData.status = 'Confirmed';
            updateData.transactionId = queryData['transaction-id'] || queryData.transaction_id;
            updateData.paymentDate = new Date();
            console.log(`✅ Payment approved for booking ${orderId} - Payment status saved as 'paid' and booking status updated to 'Confirmed'`);
        } else if (queryData.result === 2) {
            updateData.paymentStatus = 'Declined';
            console.log(`❌ Payment declined for booking ${orderId} - Status saved as 'declined'`);
        } else if (queryData.result === 3) {
            updateData.paymentStatus = 'failed';
            console.log(`❌ System error for booking ${orderId} - Status saved as 'failed'`);
        } else if (queryData.result === 4) {
            // 4 = Pending
            updateData.paymentStatus = 'pending';
            console.log(`⏳ Payment pending for booking ${orderId} - Status saved as 'pending'`);
        } else {
            // Unknown result code - default to incomplete
            updateData.paymentStatus = 'incomplete';
            console.log(`⚠️ Unknown result code ${queryData.result} for booking ${orderId} - Status saved as 'incomplete'`);
        }

        // Save payment status to database after getting response from query.php API
        const updatedBooking = await Booking.findByIdAndUpdate(
            booking._id, 
            updateData,
            { new: true } // Return updated document
        );

        if (!updatedBooking) {
            return response.error400(res, "Failed to update booking payment status");
        }

        console.log(`💾 Payment status saved successfully: ${updateData.paymentStatus} for booking ${orderId}`);

        // Populate cabin details for response
        await updatedBooking;
        
        // Populate package details if package array exists
        let packageDetailsMap = new Map();
        if (updatedBooking.package && Array.isArray(updatedBooking.package) && updatedBooking.package.length > 0) {
            // Get unique package IDs
            const uniquePackageIds = [...new Set(updatedBooking.package.map(p => p.packageId.toString()))];
            // Fetch all packages
            const packages = await Package.find({ _id: { $in: uniquePackageIds } });
            // Create a map for quick lookup
            packages.forEach(pkg => {
                packageDetailsMap.set(pkg._id.toString(), pkg);
            });
        }

        // Send confirmation email only if payment status CHANGED to 'paid' AND status CHANGED to 'Confirmed' (not already paid and confirmed)
        // This prevents duplicate emails if both redirect and callback are triggered
        const paymentStatusChanged = originalPaymentStatus !== 'paid' && updateData.paymentStatus === 'paid';
        const statusChanged = originalStatus !== 'Confirmed' && updateData.status === 'Confirmed';
        if (paymentStatusChanged && statusChanged && updatedBooking.guestDetails?.email) {
            try {
                const guestEmail = updatedBooking.guestDetails.email;
                const emailSubject = `Booking Confirmation - Reference: ${updatedBooking.bookingReference}`;
                
                // Format dates with day name and time
                const checkInDateObj = new Date(updatedBooking.checkInDate);
                const checkOutDateObj = new Date(updatedBooking.checkOutDate);
                
                const checkInDate = checkInDateObj.toLocaleDateString('en-US', { 
                    weekday: 'short',
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                }) + ' after 2 PM';
                
                const checkOutDate = checkOutDateObj.toLocaleDateString('en-US', { 
                    weekday: 'short',
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                }) + ' before 11:00 AM';
                
                // Calculate number of nights
                const nights = Math.ceil((checkOutDateObj - checkInDateObj) / (1000 * 60 * 60 * 24));
                
                // Format guests
                const adults = updatedBooking.adults || 0;
                const children = updatedBooking.children || 0;
                const guestsText = `${adults} adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} child${children !== 1 ? 'ren' : ''}` : ''}`;
                
                // Format booked by name
                const bookedBy = `${updatedBooking.guestDetails?.firstName || ''} ${updatedBooking.guestDetails?.lastName || ''}`.trim() || 'Guest';
                
                // Format amount
                const currencySymbol = updatedBooking.currency === 'USD' ? 'USD $' : updatedBooking.currency === 'GHS' ? 'GHS ₵' : (updatedBooking.currency || 'GHS') + ' ';
                const amountPaid = `${currencySymbol}${updatedBooking.totalAmount?.toLocaleString() || '0.00'}`;

                // NOTE: To embed logo as base64 for better email client compatibility, convert the image to base64:
                // const fs = require('fs');
                // const path = require('path');
                // const logoPath = path.join(__dirname, '../../admin/assets/Group 7561.png');
                // const logoBase64 = fs.readFileSync(logoPath).toString('base64');
                // const logoDataUri = `data:image/png;base64,${logoBase64}`;
                // Then use: src="${logoDataUri}" instead of the URL

                const emailMessage = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <!--[if mso]>
                        <style type="text/css">
                            body, table, td {font-family: Arial, sans-serif !important;}
                        </style>
                        <![endif]-->
                        <style>
                            * {
                                -webkit-text-size-adjust: 100%;
                                -ms-text-size-adjust: 100%;
                            }
                            body {
                                margin: 0 !important;
                                padding: 0 !important;
                                background-color: #f0f4f8;
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif;
                                line-height: 1.6;
                                color: #333;
                            }
                            table {
                                border-collapse: collapse;
                                mso-table-lspace: 0pt;
                                mso-table-rspace: 0pt;
                            }
                            img {
                                border: 0;
                                height: auto;
                                line-height: 100%;
                                outline: none;
                                text-decoration: none;
                                -ms-interpolation-mode: bicubic;
                                max-width: 100%;
                            }
                            .main-container {
                                max-width: 650px;
                                width: 100%;
                                margin: 0 auto;
                                background-color: #ffffff;
                            }
                            .header {
                                background-color: #133730;
                                padding: 25px 20px;
                                text-align: center;
                            }
                            .content-wrapper {
                                padding: 30px 25px;
                                background-color: #ffffff;
                            }
                            .confirmation-box {
                                background-color: #e8f5e9;
                                border: 2px solid #133730;
                                padding: 25px 20px;
                                margin-bottom: 25px;
                                text-align: center;
                            }
                            .confirmation-title {
                                font-size: 22px;
                                font-weight: bold;
                                color: #133730;
                                margin: 0 0 12px 0;
                                line-height: 1.3;
                            }
                            .confirmation-text {
                                font-size: 15px;
                                color: #2d5a3d;
                                line-height: 1.7;
                                margin: 0;
                            }
                            .info-box {
                                background-color: #f8f9fa;
                                border: 2px solid #e9ecef;
                                padding: 20px;
                                margin-bottom: 20px;
                            }
                            .info-box-title {
                                font-size: 17px;
                                font-weight: bold;
                                color: #133730;
                                margin: 0 0 15px 0;
                                padding-bottom: 10px;
                                border-bottom: 2px solid #133730;
                                line-height: 1.4;
                            }
                            .contact-info-box {
                                background-color: #ffffff;
                                border: 1px solid #d0d7de;
                                padding: 15px;
                                margin-top: 10px;
                            }
                            .contact-item {
                                margin: 10px 0;
                                color: #333;
                                font-size: 14px;
                                line-height: 1.6;
                            }
                            .contact-icon {
                                display: inline-block;
                                width: 24px;
                                font-size: 16px;
                                vertical-align: middle;
                            }
                            .contact-text {
                                display: inline-block;
                                vertical-align: middle;
                                width: calc(100% - 30px);
                                word-wrap: break-word;
                            }
                            .booking-details-box {
                                background-color: #ffffff;
                                border: 2px solid #133730;
                                padding: 15px;
                                margin-top: 10px;
                            }
                            .detail-item {
                                background-color: #f8f9fa;
                                border-left: 4px solid #133730;
                                padding: 12px 15px;
                                margin-bottom: 10px;
                            }
                            .detail-item:last-child {
                                margin-bottom: 0;
                            }
                            .detail-label {
                                font-weight: 600;
                                color: #555;
                                font-size: 13px;
                                display: block;
                                margin-bottom: 5px;
                                line-height: 1.4;
                            }
                            .detail-value {
                                color: #133730;
                                font-size: 14px;
                                font-weight: 600;
                                display: block;
                                word-wrap: break-word;
                                line-height: 1.5;
                            }
                            .policies-box {
                                background-color: #fff9e6;
                                border: 2px solid #ffd700;
                                padding: 20px;
                                margin-top: 10px;
                            }
                            .policy-item {
                                background-color: #ffffff;
                                border-left: 3px solid #ffd700;
                                padding: 15px;
                                margin-bottom: 12px;
                            }
                            .policy-item:last-child {
                                margin-bottom: 0;
                            }
                            .policy-title {
                                font-weight: bold;
                                color: #133730;
                                font-size: 14px;
                                margin: 0 0 8px 0;
                                line-height: 1.4;
                            }
                            .policy-text {
                                color: #555;
                                font-size: 13px;
                                line-height: 1.6;
                                margin: 0;
                            }
                            .directions-box {
                                background-color: #e8f4f8;
                                border: 2px solid #4a90a4;
                                padding: 20px;
                                margin-top: 10px;
                            }
                            .direction-step {
                                background-color: #ffffff;
                                border-left: 3px solid #4a90a4;
                                padding: 12px 15px;
                                margin-bottom: 10px;
                                color: #555;
                                font-size: 13px;
                                line-height: 1.6;
                            }
                            .direction-step:last-child {
                                margin-bottom: 0;
                            }
                            .direction-icon {
                                margin-right: 8px;
                                font-size: 14px;
                            }
                            .closing-message {
                                background-color: #f8f9fa;
                                border-top: 3px solid #133730;
                                padding: 25px 20px;
                                margin-top: 25px;
                            }
                            .closing-text {
                                font-size: 14px;
                                line-height: 1.7;
                                color: #333;
                                margin: 0 0 12px 0;
                            }
                            .signature {
                                font-size: 15px;
                                color: #133730;
                                margin-top: 15px;
                            }
                            .signature-name {
                                font-weight: bold;
                                font-size: 16px;
                            }
                            .footer {
                                background-color: #133730;
                                color: #ffffff;
                                text-align: center;
                                padding: 20px;
                                font-size: 11px;
                                line-height: 1.6;
                            }
                            .footer p {
                                margin: 5px 0;
                                color: #e0e0e0;
                            }
                            @media only screen and (max-width: 600px) {
                                .main-container {
                                    width: 100% !important;
                                    max-width: 100% !important;
                                }
                                .content-wrapper {
                                    padding: 20px 15px !important;
                                }
                                .header {
                                    padding: 20px 15px !important;
                                }
                                .confirmation-box {
                                    padding: 20px 15px !important;
                                    margin-bottom: 20px !important;
                                }
                                .confirmation-title {
                                    font-size: 20px !important;
                                }
                                .confirmation-text {
                                    font-size: 14px !important;
                                }
                                .info-box {
                                    padding: 15px !important;
                                    margin-bottom: 15px !important;
                                }
                                .info-box-title {
                                    font-size: 16px !important;
                                    margin-bottom: 12px !important;
                                }
                                .contact-info-box, .booking-details-box, .policies-box, .directions-box {
                                    padding: 12px !important;
                                }
                                .detail-item {
                                    padding: 10px 12px !important;
                                    margin-bottom: 8px !important;
                                }
                                .detail-label {
                                    font-size: 12px !important;
                                    margin-bottom: 4px !important;
                                }
                                .detail-value {
                                    font-size: 13px !important;
                                }
                                .policy-item {
                                    padding: 12px !important;
                                    margin-bottom: 10px !important;
                                }
                                .policy-title {
                                    font-size: 13px !important;
                                }
                                .policy-text {
                                    font-size: 12px !important;
                                }
                                .direction-step {
                                    padding: 10px 12px !important;
                                    margin-bottom: 8px !important;
                                    font-size: 12px !important;
                                }
                                .closing-message {
                                    padding: 20px 15px !important;
                                }
                                .closing-text {
                                    font-size: 13px !important;
                                }
                                .contact-item {
                                    font-size: 13px !important;
                                }
                                .footer {
                                    padding: 15px !important;
                                    font-size: 10px !important;
                                }
                            }
                            @media only screen and (max-width: 480px) {
                                .content-wrapper {
                                    padding: 15px 12px !important;
                                }
                                .header {
                                    padding: 18px 12px !important;
                                }
                                .confirmation-title {
                                    font-size: 18px !important;
                                }
                                .confirmation-text {
                                    font-size: 13px !important;
                                }
                                .info-box {
                                    padding: 12px !important;
                                }
                                .info-box-title {
                                    font-size: 15px !important;
                                }
                                .contact-info-box, .booking-details-box, .policies-box, .directions-box {
                                    padding: 10px !important;
                                }
                                .detail-item {
                                    padding: 8px 10px !important;
                                }
                                .detail-label {
                                    font-size: 11px !important;
                                }
                                .detail-value {
                                    font-size: 12px !important;
                                }
                                .policy-item {
                                    padding: 10px !important;
                                }
                                .policy-title {
                                    font-size: 12px !important;
                                }
                                .policy-text {
                                    font-size: 11px !important;
                                }
                                .direction-step {
                                    padding: 8px 10px !important;
                                    font-size: 11px !important;
                                }
                            }
                        </style>
                    </head>
                    <body style="margin: 0; padding: 0; background-color: #f0f4f8;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0f4f8;">
                            <tr>
                                <td align="center" style="padding: 15px 10px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="650" class="main-container" style="max-width: 650px; width: 100%; background-color: #ffffff;">
                                        <!-- Header -->
                                        <tr>
                                            <td class="header" style="background-color: #133730; padding: 25px 20px; text-align: center;">
                                                <p style="font-size: 24px; font-weight: bold; color: #ffffff; letter-spacing: 2px; margin: 0; line-height: 1.3;">PALM ISLAND RESORT</p>
                                            </td>
                                        </tr>
                                        
                                        <!-- Content -->
                                        <tr>
                                            <td class="content-wrapper" style="padding: 30px 25px; background-color: #ffffff;">
                                                <!-- Confirmation Box -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="confirmation-box" style="background-color: #e8f5e9; border: 2px solid #133730; padding: 25px 20px; text-align: center;">
                                                            <p class="confirmation-title" style="font-size: 22px; font-weight: bold; color: #133730; margin: 0 0 12px 0; line-height: 1.3;">✓ Booking Confirmed!</p>
                                                            <p class="confirmation-text" style="font-size: 15px; color: #2d5a3d; line-height: 1.7; margin: 0;">
                                                                Hi ${bookedBy},<br><br>
                                                                Thank you for booking with us. Your reservation at Palm Island Resort has been successfully confirmed.
                                                            </p>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Contact Information -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📍 Contact Information</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="contact-info-box" style="background-color: #ffffff; border: 1px solid #d0d7de; padding: 15px;">
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">📍</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Atimpoku, Eastern Region, Ghana</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">📞</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Phone: +233 53 646 3111</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">✉️</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Email: info@palmislandgh.com</span>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Booking Details -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📋 Booking Details</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="booking-details-box" style="background-color: #ffffff; border: 2px solid #133730; padding: 15px;">
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Booking Reference:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${updatedBooking.bookingReference}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check In:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkInDate}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check Out:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkOutDate}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Room:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${updatedBooking.cabinId?.name || 'Cabin'}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Number of Nights:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${nights}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Number of Guests:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${guestsText}</span>
                                                                    </td>
                                                                </tr>
                                                                ${updatedBooking.guestDetails?.specialRequests && updatedBooking.guestDetails.specialRequests.trim() ? `
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f0e6ff; border-left: 4px solid #9b59b6; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #7d3c98; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Special Request:</span>
                                                                        <span class="detail-value" style="color: #7d3c98; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; white-space: pre-wrap; line-height: 1.5;">${updatedBooking.guestDetails.specialRequests.trim()}</span>
                                                                    </td>
                                                                </tr>
                                                                ` : ''}
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #e8f5e9; border-left: 4px solid #2c5f2d; padding: 12px 15px; margin-bottom: 0;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #2c5f2d; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Amount Paid:</span>
                                                                        <span class="detail-value" style="color: #2c5f2d; font-size: 15px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${amountPaid}</span>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                ${updatedBooking.package && Array.isArray(updatedBooking.package) && updatedBooking.package.length > 0 ? `
                                                <!-- Package Details -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">🎁 Selected Packages</p>
                                                            ${updatedBooking.package.map((pkg, index) => {
                                                                const packageDetails = packageDetailsMap.get(pkg.packageId.toString());
                                                                const typeLabel = pkg.type === 1 ? 'Per Couple' : 'Per Person';
                                                                return `
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="booking-details-box" style="background-color: #ffffff; border: 2px solid #133730; padding: 15px; margin-bottom: ${index < updatedBooking.package.length - 1 ? '15px' : '0'};">
                                                                    <tr>
                                                                        <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Package Name:</span>
                                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${packageDetails?.title || 'N/A'}</span>
                                                                        </td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td class="detail-item" style="background-color: #e8f5e9; border-left: 4px solid #2c5f2d; padding: 12px 15px; margin-bottom: 0;">
                                                                            <span class="detail-value" style="color: #2c5f2d; font-size: 15px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">
                                                                                ${pkg.currency || 'GHC'} ${pkg.amount?.toLocaleString() || '0.00'}
                                                                            </span>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                                `;
                                                            }).join('')}
                                                        </td>
                                                    </tr>
                                                </table>
                                                ` : ''}

                                                <!-- Resort Policies -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📜 Resort Policies</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="policies-box" style="background-color: #fff9e6; border: 2px solid #ffd700; padding: 20px;">
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 12px;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">1. Check-In & Check-Out</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Check-in: 2:00 PM | Check-out: 11:00 AM.<br>
                                                                            Early check-in or late check-out may be available upon request and subject to a small additional fee.<br>
                                                                            Please present a valid photo ID at check-in.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 12px;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">2. Bookings & Payments</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Reservations are confirmed once full payment is received.<br>
                                                                            We accept mobile money, debit/credit cards, bank transfers, and approved online payment platforms.<br>
                                                                            All prices include applicable taxes and service charges unless stated otherwise.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 0;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">3. Cancellations & Refunds</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Cancel 7 days or more before your stay for a full refund.<br>
                                                                            Cancel 1–6 days before arrival for a 50% refund.<br>
                                                                            Same-day cancellations or no-shows are non-refundable.<br>
                                                                            Refunds are processed within 7 working days.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Directions -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">🗺️ Directions to Palm Island Resort</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="directions-box" style="background-color: #e8f4f8; border: 2px solid #4a90a4; padding: 20px;">
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🛣️</span>Take the N2/Akosombo Road towards Atimpoku (about 1 hour 15 minutes).
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">➡️</span>After passing Royal Senchi Hotel, turn right at the Royal Senchi junction.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🚗</span>Continue straight, following signs toward Sajuna Beach and JamRock Restaurant.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🏷️</span>Watch for Palm Island Resort signs leading to our secured riverside car park.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 0; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">⛴️</span>Park and ride our complimentary boat to the island — your tropical escape begins here!
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Closing Message -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="closing-message" style="background-color: #f8f9fa; border-top: 3px solid #133730; padding: 25px 20px; margin-top: 25px;">
                                                            <p class="closing-text" style="font-size: 14px; line-height: 1.7; color: #333; margin: 0 0 12px 0;">
                                                                We are thrilled to have you as our guest and look forward to providing you with an unforgettable experience at Palm Island Resort. Our team is committed to ensuring your stay is comfortable, relaxing, and memorable.
                                                            </p>
                                                            <p class="closing-text" style="font-size: 14px; line-height: 1.7; color: #333; margin: 0 0 12px 0;">
                                                                If you have any questions or special requests before your arrival, please don't hesitate to reach out to us. We're here to make your stay exceptional.
                                                            </p>
                                                            <p class="signature" style="font-size: 15px; color: #133730; margin: 15px 0 0 0;">
                                                                Warm regards,<br>
                                                                <span class="signature-name" style="font-weight: bold; font-size: 16px;">Palm Island Resort Team</span>
                                                            </p>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                        
                                        <!-- Footer -->
                                        <tr>
                                            <td class="footer" style="background-color: #133730; color: #ffffff; text-align: center; padding: 20px; font-size: 11px; line-height: 1.6;">
                                                <p style="margin: 5px 0; color: #e0e0e0;">This is an automated email. Please do not reply to this message.</p>
                                                <p style="margin: 5px 0; color: #e0e0e0;">&copy; ${new Date().getFullYear()} Palm Island Resort. All rights reserved.</p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `;

                await sendEmail({
                    to: guestEmail,
                    subject: emailSubject,
                    message: emailMessage,
                    bcc: 'info@palmislandgh.com'
                });

                console.log(`✅ Confirmation email sent to: ${guestEmail}`);
            } catch (emailError) {
                // Log email error but don't fail the request
                console.error('Failed to send confirmation email:', emailError);
            }
        }

        return response.success200(res, "Booking payment status updated and saved", {
            bookingReference: updatedBooking.bookingReference,
            paymentStatus: updatedBooking.paymentStatus,
            transactionId: updatedBooking.transactionId,
            paymentDate: updatedBooking.paymentDate,
            expressPayResult: queryData.result,
            resultText: queryData['result-text'] || queryData.result_text || 'N/A',
            apiResult: queryData
        });

    } catch (error) {
        console.error(`Error confirming booking: ${error.message}`);
        return response.serverError500(res, "Error confirming booking", error.message);
    }
};

// SIMPLIFIED PAYMENT STATUS CHECK - NO EXPRESSPAY INTEGRATION
// Check payment status for a booking
const checkPaymentStatus = async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        const booking = await Booking.findOne({ _id: bookingId, isDeleted: false });
        if (!booking) {
            return response.notFound404(res, "Booking not found");
        }

        return response.success200(res, "Payment status checked", {
            paymentStatus: booking.paymentStatus,
            message: "Payment status check completed (ExpressPay integration disabled)"
        });
    } catch (error) {
        console.error(`Error checking payment status: ${error.message}`);
        return response.serverError500(res, "Error checking payment status", error.message);
    }
};

// Dashboard API - Get all dashboard statistics
// Get dashboard statistics and analytics
const getDashboard = async (req, res) => {
    try {
        const activityOnlyPaidConfirmedFilter = {
            isDeleted: { $ne: true },
            paymentStatus: 'paid',
            status: 'Confirmed',
            ...bookingHasActivityOnlyMongo
        };

        const completedActivitiesOnlyBookings = await Booking.countDocuments(
            activityOnlyPaidConfirmedFilter
        );
        const cancelledActivitiesOnlyBookings = await Booking.countDocuments({
            isDeleted: { $ne: true },
            status: 'Cancelled',
            ...bookingHasActivityOnlyMongo
        });

        const activityOnlyPaymentStats = await Booking.aggregate([
            { $match: activityOnlyPaidConfirmedFilter },
            {
                $group: {
                    _id: null,
                    totalPayment: { $sum: '$totalAmount' }
                }
            }
        ]);
        const activitiesAmountCollected =
            activityOnlyPaymentStats.length > 0 ? activityOnlyPaymentStats[0].totalPayment : 0;

        const cabinOnlyRevenueStats = await Booking.aggregate([
            {
                $match: {
                    isDeleted: { $ne: true },
                    paymentStatus: 'paid',
                    status: { $ne: 'Cancelled' },
                    ...bookingHasCabinStayMongo
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$totalAmount' }
                }
            }
        ]);
        const cabinOnlyRevenueTillDate =
            cabinOnlyRevenueStats.length > 0 ? cabinOnlyRevenueStats[0].totalRevenue : 0;

        const activityOnlyRevenueStats = await Booking.aggregate([
            {
                $match: {
                    isDeleted: { $ne: true },
                    paymentStatus: 'paid',
                    status: { $ne: 'Cancelled' },
                    ...bookingHasActivityOnlyMongo
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$totalAmount' }
                }
            }
        ]);
        const activityOnlyRevenueTillDate =
            activityOnlyRevenueStats.length > 0 ? activityOnlyRevenueStats[0].totalRevenue : 0;

        const totalCabins = 0;
        const activeCabins = 0;

        const totalBookings = await Booking.countDocuments({ 
            paymentStatus: 'paid',
            status: { $ne: 'Cancelled' }
        });
        const cabinOnlyBookings = await Booking.countDocuments({
            isDeleted: { $ne: true },
            paymentStatus: 'paid',
            status: { $ne: 'Cancelled' },
            ...bookingHasCabinStayMongo
        });
        const cancelledBookings = await Booking.countDocuments({ 
            status: 'Cancelled'
        });
        const cancelledCabinOnlyBookings = await Booking.countDocuments({
            isDeleted: { $ne: true },
            status: 'Cancelled',
            ...bookingHasCabinStayMongo
        });

        const paymentStats = await Booking.aggregate([
            { 
                $match: { 
                    paymentStatus: 'paid',
                    status: { $ne: 'Cancelled' }
                } 
            },
            {
                $group: {
                    _id: null,
                    totalPayment: { $sum: '$totalAmount' },
                    totalPaidBookings: { $sum: 1 }
                }
            }
        ]);

        const totalPayment = paymentStats.length > 0 ? paymentStats[0].totalPayment : 0;
        const totalPaidBookings = paymentStats.length > 0 ? paymentStats[0].totalPaidBookings : 0;

        const dashboardData = {
            activitiesAmountCollected: parseFloat(activitiesAmountCollected.toFixed(2)),
            completedActivitiesOnlyBookings,
            cancelledActivitiesOnlyBookings,
            cabinOnlyRevenueTillDate: parseFloat(cabinOnlyRevenueTillDate.toFixed(2)),
            activityOnlyRevenueTillDate: parseFloat(activityOnlyRevenueTillDate.toFixed(2)),
            totalCabins,
            activeCabins,
            totalBookings,
            cabinOnlyBookings,
            totalPayment: parseFloat(totalPayment.toFixed(2)),
            cancelledBookings,
            cancelledCabinOnlyBookings
        };

        console.log("Dashboard statistics retrieved");
        return response.success200(res, "Dashboard statistics retrieved successfully", dashboardData);
    } catch (error) {
        console.error(`Error retrieving dashboard statistics: ${error.message}`);
        return response.serverError500(res, "Error retrieving dashboard statistics", error.message);
    }
};

// Get bookings for calendar display
const getCalendarBookings = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const filter = {
            isDeleted: { $ne: true },
            paymentStatus: 'paid', // Only paid bookings
            status: 'Confirmed', // Only confirmed status (excludes cancelled automatically)
            // Cabin calendar: exclude activity-only bookings (no cabin stay)
            $and: [bookingHasCabinStayMongo]
        };

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);

            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return response.error400(res, "Invalid date format. Please use YYYY-MM-DD format");
            }

            filter.$and.push(
                { checkInDate: { $lte: end } },
                { checkOutDate: { $gte: start } }
            );
        }

        const bookings = await Booking.find(filter)
            .populate({
                path: 'cabinId',
                select: 'name cabinType pricePerNight currency'
            })
            .sort({ checkInDate: 1 });

        const calendarBookings = bookings.map(booking => {
            const cabin = booking.cabinId;
            return {
                id: booking._id,
                bookingReference: booking.bookingReference,
                title: cabin ? `${cabin.name} - ${booking.guestDetails?.firstName || ''} ${booking.guestDetails?.lastName || ''}`.trim() : `Booking ${booking.bookingReference}`,
                start: booking.checkInDate,
                end: booking.checkOutDate,
                cabin: {
                    id: cabin?._id || null,
                    name: cabin?.name || 'N/A',
                    cabinType: cabin?.cabinType || 'N/A'
                },
                guest: {
                    firstName: booking.guestDetails?.firstName || '',
                    lastName: booking.guestDetails?.lastName || '',
                    email: booking.guestDetails?.email || '',
                    mobileNumber: booking.guestDetails?.mobileNumber || ''
                },
                adults: booking.adults,
                children: booking.children,
                totalAmount: booking.totalAmount,
                currency: booking.currency,
                paymentStatus: booking.paymentStatus,
                status: booking.status,
                createdAt: booking.createdAt
            };
        });

        console.log(`Retrieved ${calendarBookings.length} calendar cabin bookings (paid & confirmed; activity-only excluded)`);
        return response.success200(
            res,
            "Calendar bookings retrieved successfully",
            calendarBookings
        );
    } catch (error) {
        console.error(`Error retrieving calendar bookings: ${error.message}`);
        return response.serverError500(res, "Error retrieving calendar bookings", error.message);
    }
};

const generateIncompleteBookingEmail = (booking, packageDetailsMap = new Map()) => {
    const customerName = booking.guestDetails?.firstName || 'Guest';
    const bookingReference = booking.bookingReference || 'N/A';
    
    const checkIn = booking.checkInDate ? new Date(booking.checkInDate) : null;
    const checkOut = booking.checkOutDate ? new Date(booking.checkOutDate) : null;
    
    const checkInDate = checkIn ? checkIn.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) : 'N/A';
    const checkOutDate = checkOut ? checkOut.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) : 'N/A';
    
    let numberOfNights = 0;
    if (checkIn && checkOut) {
        const diffTime = Math.abs(checkOut - checkIn);
        numberOfNights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
    
    const adults = booking.adults || 0;
    const children = booking.children || 0;
    const currencySymbol = booking.currency === 'USD' ? 'USD $' : booking.currency === 'GHS' ? 'GHS ₵' : (booking.currency || 'GHS') + ' ';
    const totalAmount = `${currencySymbol}${booking.totalAmount?.toLocaleString() || '0.00'}`;
    const cabinName = booking.cabinId?.name || 'Cabin';
    const continueBookingLink = 'https://www.palmislandgh.com/cabins';

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <!--[if mso]>
            <style type="text/css">
                body, table, td {font-family: Arial, sans-serif !important;}
            </style>
            <![endif]-->
            <style>
                * {
                    -webkit-text-size-adjust: 100%;
                    -ms-text-size-adjust: 100%;
                }
                body {
                    margin: 0 !important;
                    padding: 0 !important;
                    background-color: #f0f4f8;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                }
                table {
                    border-collapse: collapse;
                    mso-table-lspace: 0pt;
                    mso-table-rspace: 0pt;
                }
                img {
                    border: 0;
                    height: auto;
                    line-height: 100%;
                    outline: none;
                    text-decoration: none;
                    -ms-interpolation-mode: bicubic;
                    max-width: 100%;
                }
                .main-container {
                    max-width: 650px;
                    width: 100%;
                    margin: 0 auto;
                    background-color: #ffffff;
                }
                .header {
                    background-color: #133730;
                    padding: 25px 20px;
                    text-align: center;
                }
                .header-title {
                    font-size: 22px;
                    font-weight: bold;
                    color: #ffffff;
                    letter-spacing: 1px;
                    margin: 0;
                    line-height: 1.3;
                }
                .content-wrapper {
                    padding: 30px 25px;
                    background-color: #ffffff;
                }
                .greeting {
                    font-size: 15px;
                    line-height: 1.7;
                    color: #333;
                    margin-bottom: 25px;
                }
                .info-box {
                    background-color: #f8f9fa;
                    border: 2px solid #e9ecef;
                    padding: 20px;
                    margin-bottom: 20px;
                }
                .info-box-title {
                    font-size: 17px;
                    font-weight: bold;
                    color: #133730;
                    margin: 0 0 15px 0;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #133730;
                    line-height: 1.4;
                }
                .detail-item {
                    background-color: #ffffff;
                    border-left: 4px solid #133730;
                    padding: 12px 15px;
                    margin-bottom: 10px;
                }
                .detail-item:last-child {
                    margin-bottom: 0;
                }
                .detail-label {
                    font-weight: 600;
                    color: #555;
                    font-size: 13px;
                    display: block;
                    margin-bottom: 5px;
                    line-height: 1.4;
                }
                .detail-value {
                    color: #133730;
                    font-size: 14px;
                    font-weight: 600;
                    display: block;
                    word-wrap: break-word;
                    line-height: 1.5;
                }
                .cta-button-wrapper {
                    text-align: center;
                    margin: 35px 0 25px 0;
                    padding-top: 15px;
                }
                .cta-button {
                    display: inline-block;
                    padding: 8px 20px;
                    background-color: #133730;
                    color: #ffffff !important;
                    text-decoration: none;
                    border-radius: 5px;
                    font-weight: 600;
                    font-size: 13px;
                    text-align: center;
                    line-height: 1.5;
                }
                .footer {
                    background-color: #133730;
                    color: #ffffff;
                    text-align: center;
                    padding: 20px;
                    font-size: 11px;
                    line-height: 1.6;
                }
                .footer p {
                    margin: 5px 0;
                    color: #e0e0e0;
                }
                @media only screen and (max-width: 600px) {
                    .main-container {
                        width: 100% !important;
                        max-width: 100% !important;
                    }
                    .content-wrapper {
                        padding: 20px 15px !important;
                    }
                    .header {
                        padding: 20px 15px !important;
                    }
                    .header-title {
                        font-size: 18px !important;
                        letter-spacing: 0.5px !important;
                    }
                    .info-box {
                        padding: 15px !important;
                        margin-bottom: 15px !important;
                    }
                    .info-box-title {
                        font-size: 16px !important;
                        margin-bottom: 12px !important;
                    }
                    .detail-item {
                        padding: 10px 12px !important;
                        margin-bottom: 8px !important;
                    }
                    .detail-label {
                        font-size: 12px !important;
                        margin-bottom: 4px !important;
                    }
                    .detail-value {
                        font-size: 13px !important;
                    }
                    .cta-button-wrapper {
                        margin: 30px 0 20px 0 !important;
                        padding-top: 12px !important;
                    }
                    .cta-button {
                        padding: 8px 18px !important;
                        font-size: 12px !important;
                    }
                    .greeting {
                        font-size: 14px !important;
                    }
                    .footer {
                        padding: 15px !important;
                        font-size: 10px !important;
                    }
                }
                @media only screen and (max-width: 480px) {
                    .content-wrapper {
                        padding: 15px 12px !important;
                    }
                    .header {
                        padding: 18px 12px !important;
                    }
                    .header-title {
                        font-size: 16px !important;
                    }
                    .info-box {
                        padding: 12px !important;
                    }
                    .info-box-title {
                        font-size: 15px !important;
                    }
                    .detail-item {
                        padding: 8px 10px !important;
                    }
                    .detail-label {
                        font-size: 11px !important;
                    }
                    .detail-value {
                        font-size: 12px !important;
                    }
                    .cta-button-wrapper {
                        margin: 25px 0 15px 0 !important;
                        padding-top: 10px !important;
                    }
                    .cta-button {
                        padding: 7px 16px !important;
                        font-size: 11px !important;
                    }
                    .greeting {
                        font-size: 13px !important;
                    }
                    .footer {
                        padding: 12px !important;
                        font-size: 9px !important;
                    }
                }
            </style>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f0f4f8;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0f4f8;">
                <tr>
                    <td align="center" style="padding: 15px 10px;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="650" class="main-container" style="max-width: 650px; width: 100%; background-color: #ffffff;">
                            <!-- Header -->
                            <tr>
                                <td class="header" style="background-color: #133730; padding: 25px 20px; text-align: center;">
                                    <p class="header-title" style="font-size: 22px; font-weight: bold; color: #ffffff; letter-spacing: 1px; margin: 0; line-height: 1.3;">INCOMPLETE BOOKING</p>
                                </td>
                            </tr>
                            
                            <!-- Content -->
                            <tr>
                                <td class="content-wrapper" style="padding: 30px 25px; background-color: #ffffff;">
                                    <!-- Greeting -->
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td class="greeting" style="font-size: 15px; line-height: 1.7; color: #333; margin-bottom: 25px;">
                                                Hello ${customerName},<br><br>
                                                We noticed your reservation wasn't completed. Kindly proceed with payment to complete the booking.
                                            </td>
                                        </tr>
                                    </table>
                                    
                                    <!-- Booking Details -->
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📋 Booking Details</p>
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Booking Reference:</span>
                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${bookingReference}</span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Cabin:</span>
                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${cabinName}</span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check-in:</span>
                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkInDate}</span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check-out:</span>
                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkOutDate}</span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Nights:</span>
                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${numberOfNights} ${numberOfNights === 1 ? 'night' : 'nights'}</span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Guests:</span>
                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${adults} ${adults === 1 ? 'adult' : 'adults'}${children > 0 ? `, ${children} ${children === 1 ? 'child' : 'children'}` : ''}</span>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 0;">
                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Amount:</span>
                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${totalAmount}</span>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                    </table>

                                    ${booking.package && Array.isArray(booking.package) && booking.package.length > 0 ? `
                                    <!-- Package Details -->
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">🎁 Selected Packages</p>
                                                ${booking.package.map((pkg, index) => {
                                                    const packageDetails = packageDetailsMap.get(pkg.packageId.toString());
                                                    const typeLabel = pkg.type === 1 ? 'Per Couple' : 'Per Person';
                                                    return `
                                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #ffffff; border: 2px solid #133730; padding: 15px; margin-bottom: ${index < booking.package.length - 1 ? '15px' : '0'};">
                                                        <tr>
                                                            <td class="detail-item" style="background-color: #ffffff; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Package Name:</span>
                                                                <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${packageDetails?.title || 'N/A'}</span>
                                                            </td>
                                                        </tr>
                                                        <tr>
                                                                        <td class="detail-item" style="background-color: #e8f5e9; border-left: 4px solid #2c5f2d; padding: 12px 15px; margin-bottom: 0;">
                                                                            <span class="detail-value" style="color: #2c5f2d; font-size: 15px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">
                                                                                ${pkg.currency || 'GHC'} ${pkg.amount?.toLocaleString() || '0.00'}
                                                                            </span>
                                                                        </td>
                                                        </tr>
                                                    </table>
                                                    `;
                                                }).join('')}
                                            </td>
                                        </tr>
                                    </table>
                                    ` : ''}
                                    
                                    <!-- Continue Button -->
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td class="cta-button-wrapper" style="text-align: center; margin: 35px 0 25px 0; padding-top: 15px;">
                                                <a href="${continueBookingLink}" class="cta-button" style="display: inline-block; padding: 8px 20px; background-color: #133730; color: #ffffff !important; text-decoration: none; border-radius: 5px; font-weight: 600; font-size: 13px; text-align: center; line-height: 1.5;">Continue Booking</a>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            
                            <!-- Footer -->
                            <tr>
                                <td class="footer" style="background-color: #133730; color: #ffffff; text-align: center; padding: 20px; font-size: 11px; line-height: 1.6;">
                                    <p style="margin: 5px 0; color: #e0e0e0;">This is an automated notification email from Palm Island Resort booking system.</p>
                                    <p style="margin: 5px 0; color: #e0e0e0;">&copy; ${new Date().getFullYear()} Palm Island Resort. All rights reserved.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;
};

const checkAndSendIncompleteBookingReminders = async () => {
    try {
        if (process.env.ENABLE_INCOMPLETE_BOOKING_REMINDER_EMAILS !== 'true') {
            return;
        }

        console.log(`[Cron Job] Starting incomplete booking reminder check at ${new Date().toISOString()}`);
        
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - (1 * 60 * 60 * 1000));
        
        console.log(`[Cron Job] Checking for bookings created before: ${oneHourAgo.toISOString()}`);
        
        const incompleteBookings = await Booking.find({
            paymentStatus: 'incomplete',
            status: { $ne: 'Cancelled' },
           // isDeleted: false,
            incompleteBookingEmailSent: false,
            createdAt: {
                $lte: oneHourAgo
            }
        });

        console.log(`[Cron Job] Found ${incompleteBookings.length} incomplete booking(s) to process`);

        if (incompleteBookings.length === 0) {
            console.log(`[Cron Job] No incomplete bookings found. Exiting.`);
            return;
        }

        // One reminder per checkout: split cart rows share the same bookingReference
        const seenRef = new Set();
        const dedupedIncomplete = [];
        for (const b of incompleteBookings) {
            if (seenRef.has(String(b.bookingReference))) continue;
            seenRef.add(String(b.bookingReference));
            dedupedIncomplete.push(b);
        }

        let successCount = 0;
        let errorCount = 0;

        for (const booking of dedupedIncomplete) {
            try {
                if (!booking.guestDetails?.email) {
                    console.log(`[Cron Job] Skipping booking ${booking.bookingReference}: No email address`);
                    errorCount++;
                    continue;
                }

                // Check if same mobile number already has a confirmed/paid booking
                if (booking.guestDetails?.mobileNumber) {
                    const hasConfirmedBooking = await Booking.findOne({
                        'guestDetails.mobileNumber': booking.guestDetails.mobileNumber,
                        paymentStatus: 'paid',
                        status: 'Confirmed',
                        isDeleted: { $ne: true },
                        _id: { $ne: booking._id } // Exclude current booking
                    });

                    if (hasConfirmedBooking) {
                        console.log(`[Cron Job] Skipping booking ${booking.bookingReference}: User with mobile ${booking.guestDetails.mobileNumber} already has a confirmed booking (${hasConfirmedBooking.bookingReference})`);
                        await Booking.updateMany(
                            { bookingReference: booking.bookingReference },
                            { $set: { incompleteBookingEmailSent: true } }
                        );
                        continue;
                    }
                }

                // Populate package details if package array exists
                let packageDetailsMap = new Map();
                if (booking.package && Array.isArray(booking.package) && booking.package.length > 0) {
                    // Get unique package IDs
                    const uniquePackageIds = [...new Set(booking.package.map(p => p.packageId.toString()))];
                    // Fetch all packages
                    const packages = await Package.find({ _id: { $in: uniquePackageIds } });
                    // Create a map for quick lookup
                    packages.forEach(pkg => {
                        packageDetailsMap.set(pkg._id.toString(), pkg);
                    });
                }

                console.log(`[Cron Job] Processing booking ${booking.bookingReference} for ${booking.guestDetails.email}`);

                if (shouldUseCartIncompleteEmail(booking)) {
                    await sendCartIncompleteReminderEmail(booking, packageDetailsMap);
                } else {
                    const emailContent = generateIncompleteBookingEmail(booking, packageDetailsMap);

                    await sendEmail({
                        to: booking.guestDetails.email,
                        subject: 'Incomplete booking',
                        message: emailContent,
                        bcc: 'info@palmislandgh.com'
                    });
                }

                await Booking.updateMany(
                    { bookingReference: booking.bookingReference },
                    { $set: { incompleteBookingEmailSent: true } }
                );

                successCount++;
                console.log(`[Cron Job] ✅ Email sent successfully to ${booking.guestDetails.email} for booking ${booking.bookingReference}`);

            } catch (error) {
                errorCount++;
                console.error(`[Cron Job] ❌ Failed to send reminder email for booking ${booking.bookingReference}:`, error.message);
            }
        }

        console.log(`[Cron Job] Completed: ${successCount} email(s) sent, ${errorCount} error(s)`);

    } catch (error) {
        console.error('[Cron Job] ❌ Fatal error in incomplete booking reminder check:', error);
    }
};

// Helper function to send confirmation email (extracted from existing code)
const sendConfirmationEmail = async (booking, packageDetailsMap = new Map()) => {
    try {
        if (!booking.guestDetails?.email) {
            console.log(`[Email] Skipping confirmation email for booking ${booking.bookingReference}: No email address`);
            return;
        }

        const guestEmail = booking.guestDetails.email;
        const emailSubject = `Booking Confirmation - Reference: ${booking.bookingReference}`;
        
        // Format dates with day name and time
        const checkInDateObj = new Date(booking.checkInDate);
        const checkOutDateObj = new Date(booking.checkOutDate);
        
        const checkInDate = checkInDateObj.toLocaleDateString('en-US', { 
            weekday: 'short',
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        }) + ' after 2 PM';
        
        const checkOutDate = checkOutDateObj.toLocaleDateString('en-US', { 
            weekday: 'short',
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        }) + ' before 11:00 AM';
        
        // Calculate number of nights
        const nights = Math.ceil((checkOutDateObj - checkInDateObj) / (1000 * 60 * 60 * 24));
        
        // Format guests
        const adults = booking.adults || 0;
        const children = booking.children || 0;
        const guestsText = `${adults} adult${adults !== 1 ? 's' : ''}${children > 0 ? `, ${children} child${children !== 1 ? 'ren' : ''}` : ''}`;
        
        // Format booked by name
        const bookedBy = `${booking.guestDetails?.firstName || ''} ${booking.guestDetails?.lastName || ''}`.trim() || 'Guest';
        
        // Format amount
        const currencySymbol = booking.currency === 'USD' ? 'USD $' : booking.currency === 'GHS' ? 'GHS ₵' : (booking.currency || 'GHS') + ' ';
        const amountPaid = `${currencySymbol}${booking.totalAmount?.toLocaleString() || '0.00'}`;

        // Full email template - same as confirmBooking function
        const emailMessage = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <!--[if mso]>
                        <style type="text/css">
                            body, table, td {font-family: Arial, sans-serif !important;}
                        </style>
                        <![endif]-->
                        <style>
                            * {
                                -webkit-text-size-adjust: 100%;
                                -ms-text-size-adjust: 100%;
                            }
                            body {
                                margin: 0 !important;
                                padding: 0 !important;
                                background-color: #f0f4f8;
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif;
                                line-height: 1.6;
                                color: #333;
                            }
                            table {
                                border-collapse: collapse;
                                mso-table-lspace: 0pt;
                                mso-table-rspace: 0pt;
                            }
                            img {
                                border: 0;
                                height: auto;
                                line-height: 100%;
                                outline: none;
                                text-decoration: none;
                                -ms-interpolation-mode: bicubic;
                                max-width: 100%;
                            }
                            .main-container {
                                max-width: 650px;
                                width: 100%;
                                margin: 0 auto;
                                background-color: #ffffff;
                            }
                            .header {
                                background-color: #133730;
                                padding: 25px 20px;
                                text-align: center;
                            }
                            .content-wrapper {
                                padding: 30px 25px;
                                background-color: #ffffff;
                            }
                            .confirmation-box {
                                background-color: #e8f5e9;
                                border: 2px solid #133730;
                                padding: 25px 20px;
                                margin-bottom: 25px;
                                text-align: center;
                            }
                            .confirmation-title {
                                font-size: 22px;
                                font-weight: bold;
                                color: #133730;
                                margin: 0 0 12px 0;
                                line-height: 1.3;
                            }
                            .confirmation-text {
                                font-size: 15px;
                                color: #2d5a3d;
                                line-height: 1.7;
                                margin: 0;
                            }
                            .info-box {
                                background-color: #f8f9fa;
                                border: 2px solid #e9ecef;
                                padding: 20px;
                                margin-bottom: 20px;
                            }
                            .info-box-title {
                                font-size: 17px;
                                font-weight: bold;
                                color: #133730;
                                margin: 0 0 15px 0;
                                padding-bottom: 10px;
                                border-bottom: 2px solid #133730;
                                line-height: 1.4;
                            }
                            .contact-info-box {
                                background-color: #ffffff;
                                border: 1px solid #d0d7de;
                                padding: 15px;
                                margin-top: 10px;
                            }
                            .contact-item {
                                margin: 10px 0;
                                color: #333;
                                font-size: 14px;
                                line-height: 1.6;
                            }
                            .contact-icon {
                                display: inline-block;
                                width: 24px;
                                font-size: 16px;
                                vertical-align: middle;
                            }
                            .contact-text {
                                display: inline-block;
                                vertical-align: middle;
                                width: calc(100% - 30px);
                                word-wrap: break-word;
                            }
                            .booking-details-box {
                                background-color: #ffffff;
                                border: 2px solid #133730;
                                padding: 15px;
                                margin-top: 10px;
                            }
                            .detail-item {
                                background-color: #f8f9fa;
                                border-left: 4px solid #133730;
                                padding: 12px 15px;
                                margin-bottom: 10px;
                            }
                            .detail-item:last-child {
                                margin-bottom: 0;
                            }
                            .detail-label {
                                font-weight: 600;
                                color: #555;
                                font-size: 13px;
                                display: block;
                                margin-bottom: 5px;
                                line-height: 1.4;
                            }
                            .detail-value {
                                color: #133730;
                                font-size: 14px;
                                font-weight: 600;
                                display: block;
                                word-wrap: break-word;
                                line-height: 1.5;
                            }
                            .policies-box {
                                background-color: #fff9e6;
                                border: 2px solid #ffd700;
                                padding: 20px;
                                margin-top: 10px;
                            }
                            .policy-item {
                                background-color: #ffffff;
                                border-left: 3px solid #ffd700;
                                padding: 15px;
                                margin-bottom: 12px;
                            }
                            .policy-item:last-child {
                                margin-bottom: 0;
                            }
                            .policy-title {
                                font-weight: bold;
                                color: #133730;
                                font-size: 14px;
                                margin: 0 0 8px 0;
                                line-height: 1.4;
                            }
                            .policy-text {
                                color: #555;
                                font-size: 13px;
                                line-height: 1.6;
                                margin: 0;
                            }
                            .directions-box {
                                background-color: #e8f4f8;
                                border: 2px solid #4a90a4;
                                padding: 20px;
                                margin-top: 10px;
                            }
                            .direction-step {
                                background-color: #ffffff;
                                border-left: 3px solid #4a90a4;
                                padding: 12px 15px;
                                margin-bottom: 10px;
                                color: #555;
                                font-size: 13px;
                                line-height: 1.6;
                            }
                            .direction-step:last-child {
                                margin-bottom: 0;
                            }
                            .direction-icon {
                                margin-right: 8px;
                                font-size: 14px;
                            }
                            .closing-message {
                                background-color: #f8f9fa;
                                border-top: 3px solid #133730;
                                padding: 25px 20px;
                                margin-top: 25px;
                            }
                            .closing-text {
                                font-size: 14px;
                                line-height: 1.7;
                                color: #333;
                                margin: 0 0 12px 0;
                            }
                            .signature {
                                font-size: 15px;
                                color: #133730;
                                margin-top: 15px;
                            }
                            .signature-name {
                                font-weight: bold;
                                font-size: 16px;
                            }
                            .footer {
                                background-color: #133730;
                                color: #ffffff;
                                text-align: center;
                                padding: 20px;
                                font-size: 11px;
                                line-height: 1.6;
                            }
                            .footer p {
                                margin: 5px 0;
                                color: #e0e0e0;
                            }
                            @media only screen and (max-width: 600px) {
                                .main-container {
                                    width: 100% !important;
                                    max-width: 100% !important;
                                }
                                .content-wrapper {
                                    padding: 20px 15px !important;
                                }
                                .header {
                                    padding: 20px 15px !important;
                                }
                                .confirmation-box {
                                    padding: 20px 15px !important;
                                    margin-bottom: 20px !important;
                                }
                                .confirmation-title {
                                    font-size: 20px !important;
                                }
                                .confirmation-text {
                                    font-size: 14px !important;
                                }
                                .info-box {
                                    padding: 15px !important;
                                    margin-bottom: 15px !important;
                                }
                                .info-box-title {
                                    font-size: 16px !important;
                                    margin-bottom: 12px !important;
                                }
                                .contact-info-box, .booking-details-box, .policies-box, .directions-box {
                                    padding: 12px !important;
                                }
                                .detail-item {
                                    padding: 10px 12px !important;
                                    margin-bottom: 8px !important;
                                }
                                .detail-label {
                                    font-size: 12px !important;
                                    margin-bottom: 4px !important;
                                }
                                .detail-value {
                                    font-size: 13px !important;
                                }
                                .policy-item {
                                    padding: 12px !important;
                                    margin-bottom: 10px !important;
                                }
                                .policy-title {
                                    font-size: 13px !important;
                                }
                                .policy-text {
                                    font-size: 12px !important;
                                }
                                .direction-step {
                                    padding: 10px 12px !important;
                                    margin-bottom: 8px !important;
                                    font-size: 12px !important;
                                }
                                .closing-message {
                                    padding: 20px 15px !important;
                                }
                                .closing-text {
                                    font-size: 13px !important;
                                }
                                .contact-item {
                                    font-size: 13px !important;
                                }
                                .footer {
                                    padding: 15px !important;
                                    font-size: 10px !important;
                                }
                            }
                            @media only screen and (max-width: 480px) {
                                .content-wrapper {
                                    padding: 15px 12px !important;
                                }
                                .header {
                                    padding: 18px 12px !important;
                                }
                                .confirmation-title {
                                    font-size: 18px !important;
                                }
                                .confirmation-text {
                                    font-size: 13px !important;
                                }
                                .info-box {
                                    padding: 12px !important;
                                }
                                .info-box-title {
                                    font-size: 15px !important;
                                }
                                .contact-info-box, .booking-details-box, .policies-box, .directions-box {
                                    padding: 10px !important;
                                }
                                .detail-item {
                                    padding: 8px 10px !important;
                                }
                                .detail-label {
                                    font-size: 11px !important;
                                }
                                .detail-value {
                                    font-size: 12px !important;
                                }
                                .policy-item {
                                    padding: 10px !important;
                                }
                                .policy-title {
                                    font-size: 12px !important;
                                }
                                .policy-text {
                                    font-size: 11px !important;
                                }
                                .direction-step {
                                    padding: 8px 10px !important;
                                    font-size: 11px !important;
                                }
                            }
                        </style>
                    </head>
                    <body style="margin: 0; padding: 0; background-color: #f0f4f8;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f0f4f8;">
                            <tr>
                                <td align="center" style="padding: 15px 10px;">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="650" class="main-container" style="max-width: 650px; width: 100%; background-color: #ffffff;">
                                        <!-- Header -->
                                        <tr>
                                            <td class="header" style="background-color: #133730; padding: 25px 20px; text-align: center;">
                                                <p style="font-size: 24px; font-weight: bold; color: #ffffff; letter-spacing: 2px; margin: 0; line-height: 1.3;">PALM ISLAND RESORT</p>
                                            </td>
                                        </tr>
                                        
                                        <!-- Content -->
                                        <tr>
                                            <td class="content-wrapper" style="padding: 30px 25px; background-color: #ffffff;">
                                                <!-- Confirmation Box -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="confirmation-box" style="background-color: #e8f5e9; border: 2px solid #133730; padding: 25px 20px; text-align: center;">
                                                            <p class="confirmation-title" style="font-size: 22px; font-weight: bold; color: #133730; margin: 0 0 12px 0; line-height: 1.3;">✓ Booking Confirmed!</p>
                                                            <p class="confirmation-text" style="font-size: 15px; color: #2d5a3d; line-height: 1.7; margin: 0;">
                                                                Hi ${bookedBy},<br><br>
                                                                Thank you for booking with us. Your reservation at Palm Island Resort has been successfully confirmed.
                                                            </p>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Contact Information -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📍 Contact Information</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="contact-info-box" style="background-color: #ffffff; border: 1px solid #d0d7de; padding: 15px;">
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">📍</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Atimpoku, Eastern Region, Ghana</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">📞</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Phone: +233 53 646 3111</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="contact-item" style="margin: 10px 0; color: #333; font-size: 14px; line-height: 1.6; padding: 5px 0;">
                                                                        <span class="contact-icon" style="display: inline-block; width: 24px; font-size: 16px; vertical-align: middle;">✉️</span>
                                                                        <span class="contact-text" style="display: inline-block; vertical-align: middle; width: calc(100% - 30px); word-wrap: break-word;">Email: info@palmislandgh.com</span>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Booking Details -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📋 Booking Details</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="booking-details-box" style="background-color: #ffffff; border: 2px solid #133730; padding: 15px;">
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Booking Reference:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${booking.bookingReference}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check In:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkInDate}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Check Out:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${checkOutDate}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Room:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${booking.cabinId?.name || 'Cabin'}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Number of Nights:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${nights}</span>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Number of Guests:</span>
                                                                        <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${guestsText}</span>
                                                                    </td>
                                                                </tr>
                                                                ${booking.guestDetails?.specialRequests && booking.guestDetails.specialRequests.trim() ? `
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #f0e6ff; border-left: 4px solid #9b59b6; padding: 12px 15px; margin-bottom: 10px;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #7d3c98; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Special Request:</span>
                                                                        <span class="detail-value" style="color: #7d3c98; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; white-space: pre-wrap; line-height: 1.5;">${booking.guestDetails.specialRequests.trim()}</span>
                                                                    </td>
                                                                </tr>
                                                                ` : ''}
                                                                <tr>
                                                                    <td class="detail-item" style="background-color: #e8f5e9; border-left: 4px solid #2c5f2d; padding: 12px 15px; margin-bottom: 0;">
                                                                        <span class="detail-label" style="font-weight: 600; color: #2c5f2d; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Amount Paid:</span>
                                                                        <span class="detail-value" style="color: #2c5f2d; font-size: 15px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${amountPaid}</span>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                ${booking.package && Array.isArray(booking.package) && booking.package.length > 0 ? `
                                                <!-- Package Details -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">🎁 Selected Packages</p>
                                                            ${booking.package.map((pkg, index) => {
                                                                const packageDetails = packageDetailsMap.get(pkg.packageId.toString());
                                                                const typeLabel = pkg.type === 1 ? 'Per Couple' : 'Per Person';
                                                                return `
                                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="booking-details-box" style="background-color: #ffffff; border: 2px solid #133730; padding: 15px; margin-bottom: ${index < booking.package.length - 1 ? '15px' : '0'};">
                                                                    <tr>
                                                                        <td class="detail-item" style="background-color: #f8f9fa; border-left: 4px solid #133730; padding: 12px 15px; margin-bottom: 10px;">
                                                                            <span class="detail-label" style="font-weight: 600; color: #555; font-size: 13px; display: block; margin-bottom: 5px; line-height: 1.4;">Package Name:</span>
                                                                            <span class="detail-value" style="color: #133730; font-size: 14px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">${packageDetails?.title || 'N/A'}</span>
                                                                        </td>
                                                                    </tr>
                                                                    <tr>
                                                                        <td class="detail-item" style="background-color: #e8f5e9; border-left: 4px solid #2c5f2d; padding: 12px 15px; margin-bottom: 0;">
                                                                            <span class="detail-value" style="color: #2c5f2d; font-size: 15px; font-weight: 600; display: block; word-wrap: break-word; line-height: 1.5;">
                                                                                ${pkg.currency || 'GHC'} ${pkg.amount?.toLocaleString() || '0.00'}
                                                                            </span>
                                                                        </td>
                                                                    </tr>
                                                                </table>
                                                                `;
                                                            }).join('')}
                                                        </td>
                                                    </tr>
                                                </table>
                                                ` : ''}

                                                <!-- Resort Policies -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">📜 Resort Policies</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="policies-box" style="background-color: #fff9e6; border: 2px solid #ffd700; padding: 20px;">
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 12px;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">1. Check-In & Check-Out</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Check-in: 2:00 PM | Check-out: 11:00 AM.<br>
                                                                            Early check-in or late check-out may be available upon request and subject to a small additional fee.<br>
                                                                            Please present a valid photo ID at check-in.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 12px;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">2. Bookings & Payments</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Reservations are confirmed once full payment is received.<br>
                                                                            We accept mobile money, debit/credit cards, bank transfers, and approved online payment platforms.<br>
                                                                            All prices include applicable taxes and service charges unless stated otherwise.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="policy-item" style="background-color: #ffffff; border-left: 3px solid #ffd700; padding: 15px; margin-bottom: 0;">
                                                                        <p class="policy-title" style="font-weight: bold; color: #133730; font-size: 14px; margin: 0 0 8px 0; line-height: 1.4;">3. Cancellations & Refunds</p>
                                                                        <p class="policy-text" style="color: #555; font-size: 13px; line-height: 1.6; margin: 0;">
                                                                            Cancel 7 days or more before your stay for a full refund.<br>
                                                                            Cancel 1–6 days before arrival for a 50% refund.<br>
                                                                            Same-day cancellations or no-shows are non-refundable.<br>
                                                                            Refunds are processed within 7 working days.
                                                                        </p>
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Directions -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="info-box" style="background-color: #f8f9fa; border: 2px solid #e9ecef; padding: 20px; margin-bottom: 20px;">
                                                            <p class="info-box-title" style="font-size: 17px; font-weight: bold; color: #133730; margin: 0 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #133730; line-height: 1.4;">🗺️ Directions to Palm Island Resort</p>
                                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="directions-box" style="background-color: #e8f4f8; border: 2px solid #4a90a4; padding: 20px;">
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🛣️</span>Take the N2/Akosombo Road towards Atimpoku (about 1 hour 15 minutes).
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">➡️</span>After passing Royal Senchi Hotel, turn right at the Royal Senchi junction.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🚗</span>Continue straight, following signs toward Sajuna Beach and JamRock Restaurant.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 10px; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">🏷️</span>Watch for Palm Island Resort signs leading to our secured riverside car park.
                                                                    </td>
                                                                </tr>
                                                                <tr>
                                                                    <td class="direction-step" style="background-color: #ffffff; border-left: 3px solid #4a90a4; padding: 12px 15px; margin-bottom: 0; color: #555; font-size: 13px; line-height: 1.6;">
                                                                        <span class="direction-icon" style="margin-right: 8px; font-size: 14px;">⛴️</span>Park and ride our complimentary boat to the island — your tropical escape begins here!
                                                                    </td>
                                                                </tr>
                                                            </table>
                                                        </td>
                                                    </tr>
                                                </table>

                                                <!-- Closing Message -->
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    <tr>
                                                        <td class="closing-message" style="background-color: #f8f9fa; border-top: 3px solid #133730; padding: 25px 20px; margin-top: 25px;">
                                                            <p class="closing-text" style="font-size: 14px; line-height: 1.7; color: #333; margin: 0 0 12px 0;">
                                                                We are thrilled to have you as our guest and look forward to providing you with an unforgettable experience at Palm Island Resort. Our team is committed to ensuring your stay is comfortable, relaxing, and memorable.
                                                            </p>
                                                            <p class="closing-text" style="font-size: 14px; line-height: 1.7; color: #333; margin: 0 0 12px 0;">
                                                                If you have any questions or special requests before your arrival, please don't hesitate to reach out to us. We're here to make your stay exceptional.
                                                            </p>
                                                            <p class="signature" style="font-size: 15px; color: #133730; margin: 15px 0 0 0;">
                                                                Warm regards,<br>
                                                                <span class="signature-name" style="font-weight: bold; font-size: 16px;">Palm Island Resort Team</span>
                                                            </p>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                        
                                        <!-- Footer -->
                                        <tr>
                                            <td class="footer" style="background-color: #133730; color: #ffffff; text-align: center; padding: 20px; font-size: 11px; line-height: 1.6;">
                                                <p style="margin: 5px 0; color: #e0e0e0;">This is an automated email. Please do not reply to this message.</p>
                                                <p style="margin: 5px 0; color: #e0e0e0;">&copy; ${new Date().getFullYear()} Palm Island Resort. All rights reserved.</p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </body>
                    </html>
                `;

        await sendEmail({
            to: guestEmail,
            subject: emailSubject,
            message: emailMessage,
            bcc: 'info@palmislandgh.com'
        });

        console.log(`✅ Confirmation email sent to: ${guestEmail} for booking ${booking.bookingReference}`);
    } catch (emailError) {
        console.error(`Failed to send confirmation email for booking ${booking.bookingReference}:`, emailError);
    }
};

// Cron job to check pending bookings and verify payment status via ExpressPay Query API
const checkPendingBookingsPaymentStatus = async () => {
    try {
        console.log(`[Pending Payment Check] Starting check at ${new Date().toISOString()}`);
        
        // Find all bookings with paymentStatus = 'pending' (ExpressPay / non-Paystack — Paystack uses Paystack verify cron)
        const pendingBookings = await Booking.find({
            paymentStatus: 'pending',
            status: { $ne: 'Cancelled' },
            isDeleted: { $ne: true },
            paymentMethod: { $ne: 'Paystack' },
            paymentToken: { $exists: true, $ne: null } // Must have paymentToken to query
        });

        console.log(`[Pending Payment Check] Found ${pendingBookings.length} pending booking(s) to check`);

        if (pendingBookings.length === 0) {
            console.log(`[Pending Payment Check] No pending bookings found. Exiting.`);
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        let approvedCount = 0;

        for (const booking of pendingBookings) {
            try {
                if (!booking.paymentToken) {
                    console.log(`[Pending Payment Check] Skipping booking ${booking.bookingReference}: No payment token`);
                    errorCount++;
                    continue;
                }

                // Query ExpressPay API to check payment status
                const queryUrl = process.env.EXPRESSPAY_QUERY_URL;
                const queryPayload = {
                    'merchant-id': process.env.EXPRESSPAY_MERCHANT_ID,
                    'api-key': process.env.EXPRESSPAY_API_KEY,
                    'token': booking.paymentToken
                };

                const formBody = new URLSearchParams();
                for (const [key, value] of Object.entries(queryPayload)) {
                    if (value !== undefined && value !== null) {
                        formBody.append(key, String(value));
                    }
                }

                const queryResponse = await fetch(queryUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formBody.toString()
                });

                const queryData = await queryResponse.json();
                console.log(`[Pending Payment Check] Query response for booking ${booking.bookingReference}:`, JSON.stringify(queryData, null, 2));

                // Store original payment status
                const originalPaymentStatus = booking.paymentStatus;
                const originalStatus = booking.status;

                let updateData = {
                    paymentResponse: queryData,
                    updatedAt: new Date()
                };

                // Handle result codes from Query API
                if (queryData.result === 1) {
                    // 1 = Approved - Payment confirmed
                    updateData.paymentStatus = 'paid';
                    updateData.status = 'Confirmed';
                    updateData.transactionId = queryData['transaction-id'] || queryData.transaction_id;
                    updateData.paymentDate = new Date();
                    
                    console.log(`[Pending Payment Check] ✅ Payment approved for booking ${booking.bookingReference} - Updating to 'paid' and 'Confirmed'`);

                    // Update booking in database
                    const updatedBooking = await Booking.findByIdAndUpdate(
                        booking._id,
                        updateData,
                        { new: true }
                    );

                    if (!updatedBooking) {
                        console.error(`[Pending Payment Check] ❌ Failed to update booking ${booking.bookingReference}`);
                        errorCount++;
                        continue;
                    }

                    // Populate package details for email
                    let packageDetailsMap = new Map();
                    if (updatedBooking.package && Array.isArray(updatedBooking.package) && updatedBooking.package.length > 0) {
                        const uniquePackageIds = [...new Set(updatedBooking.package.map(p => p.packageId.toString()))];
                        const packages = await Package.find({ _id: { $in: uniquePackageIds } });
                        packages.forEach(pkg => {
                            packageDetailsMap.set(pkg._id.toString(), pkg);
                        });
                    }

                    // Send confirmation email only if status changed from pending to paid/confirmed
                    const paymentStatusChanged = originalPaymentStatus !== 'paid' && updateData.paymentStatus === 'paid';
                    const statusChanged = originalStatus !== 'Confirmed' && updateData.status === 'Confirmed';
                    
                    if (paymentStatusChanged && statusChanged) {
                        await sendConfirmationEmail(updatedBooking, packageDetailsMap);
                    }

                    approvedCount++;
                    successCount++;
                    console.log(`[Pending Payment Check] ✅ Successfully updated booking ${booking.bookingReference} to paid/confirmed`);

                } else if (queryData.result === 2) {
                    // 2 = Declined
                    updateData.paymentStatus = 'declined';
                    await Booking.findByIdAndUpdate(booking._id, updateData);
                    console.log(`[Pending Payment Check] ❌ Payment declined for booking ${booking.bookingReference}`);
                    successCount++;
                } else if (queryData.result === 3) {
                    // 3 = Error
                    updateData.paymentStatus = 'failed';
                    await Booking.findByIdAndUpdate(booking._id, updateData);
                    console.log(`[Pending Payment Check] ❌ Payment failed for booking ${booking.bookingReference}`);
                    successCount++;
                } else if (queryData.result === 4) {
                    // 4 = Still Pending
                    console.log(`[Pending Payment Check] ⏳ Payment still pending for booking ${booking.bookingReference}`);
                    successCount++;
                } else {
                    // Unknown result code
                    console.log(`[Pending Payment Check] ⚠️ Unknown result code ${queryData.result} for booking ${booking.bookingReference}`);
                    successCount++;
                }

            } catch (error) {
                errorCount++;
                console.error(`[Pending Payment Check] ❌ Error processing booking ${booking.bookingReference}:`, error.message);
            }
        }

        console.log(`[Pending Payment Check] Completed: ${successCount} processed, ${approvedCount} approved, ${errorCount} error(s)`);

    } catch (error) {
        console.error('[Pending Payment Check] ❌ Fatal error in pending payment check:', error);
    }
};

/**
 * Cron helper: poll Paystack for bookings still incomplete/pending (same as GET /paystack/verify).
 * Uses verifyAndConfirmBooking (PAYSTACK_SECRET_KEY + sendConfirmationEmail).
 */
const checkPendingPaystackBookingsPaymentStatus = async () => {
    try {
        console.log(`[Paystack Pending Check] Starting check at ${new Date().toISOString()}`);

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        const paystackOpenBookings = await Booking.find({
            paymentMethod: 'Paystack',
            status: 'Pending',
            paymentStatus: { $in: ['incomplete', 'pending'] },
            isDeleted: { $ne: true },
            bookingReference: { $exists: true, $nin: [null, ''] },
            createdAt: { $gte: oneHourAgo }
        }).select('bookingReference paymentStatus status createdAt');

        console.log(
            `[Paystack Pending Check] Found ${paystackOpenBookings.length} Paystack booking(s) to verify (created within last 1 hour, since ${oneHourAgo.toISOString()})`
        );

        if (paystackOpenBookings.length === 0) {
            console.log(`[Paystack Pending Check] Nothing to process. Exiting.`);
            return;
        }

        const { verifyAndConfirmBooking } = require('./paystackController');

        let ok = 0;
        let failed = 0;
        let approved = 0;

        for (const booking of paystackOpenBookings) {
            try {
                const ref = booking.bookingReference;
                console.log(`[Paystack Pending Check] Verifying ${ref} (paymentStatus=${booking.paymentStatus})`);

                const result = await verifyAndConfirmBooking(ref);

                if (result.success) {
                    ok++;
                    if (!result.alreadyPaid) approved++;
                    console.log(`[Paystack Pending Check] ✅ ${ref} success (alreadyPaid=${!!result.alreadyPaid})`);
                } else {
                    ok++;
                    if (result.inProgress) {
                        console.log(`[Paystack Pending Check] ⏳ ${ref} still in progress`);
                    } else {
                        console.log(`[Paystack Pending Check] ℹ️ ${ref}: ${result.error || 'not successful'}`);
                    }
                }
            } catch (err) {
                failed++;
                console.error(`[Paystack Pending Check] ❌ Error for ${booking.bookingReference}:`, err.message);
            }
        }

        console.log(`[Paystack Pending Check] Done: ${ok} processed, ${approved} newly confirmed, ${failed} error(s)`);
    } catch (error) {
        console.error('[Paystack Pending Check] ❌ Fatal error:', error);
    }
};

module.exports = {
    getAllBookings,
    getBookingById,
    updateBookingStatus,
    manualConfirmBooking,
    cancelBooking,
    getBookingStatistics,
    getDashboard,
    getCalendarBookings,
    checkPaymentStatus,
    sendConfirmationEmail
};
