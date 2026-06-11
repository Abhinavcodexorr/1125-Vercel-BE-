const mongoose = require('mongoose');
const Room = require('./roomModel');
const Booking = require('../Booking/bookingModel');
const response = require('../../helper/response');
const msg = require('./roomMessages');
const {
    getAllRoomBlockingBookings,
    buildFullRoomAvailability,
    getRoomBlockedDateData,
    validateRoomQuantityUpdate,
    getRoomQuantity,
    computeNights,
    toDateOnly,
    formatDateKey
} = require('./roomAvailabilityHelper');
const {
    parseStayQuery,
    shapeRoomForWebsite,
    filterRoomsForStay,
    evaluateRoomStay
} = require('./roomWebsiteHelper');

const slugify = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);

const isObjectId = (value) =>
    mongoose.Types.ObjectId.isValid(value) &&
    String(new mongoose.Types.ObjectId(value)) === String(value);

const buildRoomLookup = (param, extra = {}) => {
    const filter = { isDeleted: false, ...extra };
    if (isObjectId(param)) {
        filter._id = param;
    } else {
        filter.slug = slugify(param);
    }
    return filter;
};

const ensureUniqueSlug = async (rawSlug, excludeId = null) => {
    const base = slugify(rawSlug);
    if (!base) return null;
    let candidate = base;
    let suffix = 1;
    while (true) {
        const filter = { slug: candidate, isDeleted: false };
        if (excludeId) filter._id = { $ne: excludeId };
        const exists = await Room.findOne(filter).select('_id').lean();
        if (!exists) return candidate;
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }
};

const resolveRoom = async (param) => Room.findOne(buildRoomLookup(param));

const createRoom = async (req, res) => {
    try {
        const { title, slug, type, description, price, currency, guests, quantity, size, unit, amenities, images, isActive } = req.body;

        if (!title || !String(title).trim()) {
            return response.error400(res, msg.TITLE_REQUIRED);
        }
        if (!type || !String(type).trim()) {
            return response.error400(res, msg.TYPE_REQUIRED);
        }
        const priceNum = parseFloat(price);
        if (isNaN(priceNum) || priceNum < 0) {
            return response.error400(res, msg.PRICE_REQUIRED);
        }
        const guestsNum = parseInt(guests, 10);
        if (isNaN(guestsNum) || guestsNum < 1) {
            return response.error400(res, msg.GUESTS_MIN);
        }
        const quantityNum = quantity != null && quantity !== '' ? parseInt(quantity, 10) : 1;
        if (isNaN(quantityNum) || quantityNum < 1) {
            return response.error400(res, msg.QUANTITY_MIN);
        }
        if (size === undefined || size === null || size === '') {
            return response.error400(res, msg.SIZE_REQUIRED);
        }
        const sizeNum = parseFloat(size);
        if (isNaN(sizeNum) || sizeNum < 0) {
            return response.error400(res, msg.SIZE_INVALID);
        }

        const uniqueSlug = await ensureUniqueSlug(slug || title);
        if (!uniqueSlug) {
            return response.error400(res, msg.SLUG_REQUIRED);
        }

        const roomAmenities = Array.isArray(amenities)
            ? amenities
                  .filter((a) => a && String(a.name || '').trim() && String(a.icon || '').trim())
                  .map((a) => ({
                      key: a.key ? String(a.key).trim() : '',
                      name: String(a.name).trim(),
                      icon: String(a.icon).trim(),
                      iconType: a.iconType ? String(a.iconType).trim() : 'material'
                  }))
            : [];

        const roomImages = Array.isArray(images)
            ? images
                  .filter((img) => img && String(img.url || '').trim())
                  .map((img, index) => ({
                      url: String(img.url).trim(),
                      order: Number.isFinite(Number(img.order)) ? Number(img.order) : index
                  }))
            : [];

        const roomCurrency =
            currency != null && String(currency).trim()
                ? String(currency).trim().toUpperCase()
                : 'GHS';

        const room = new Room({
            title: String(title).trim(),
            slug: uniqueSlug,
            type: String(type).trim(),
            description: description != null ? String(description) : '',
            price: priceNum,
            currency: roomCurrency,
            guests: guestsNum,
            quantity: quantityNum,
            size: sizeNum,
            unit: unit != null && String(unit).trim() ? String(unit).trim() : 'sq ft',
            amenities: roomAmenities,
            images: roomImages,
            isActive: isActive !== undefined ? !!isActive : true,
            isDeleted: false
        });
        await room.save();

        return response.created201(res, msg.ROOM_CREATED, room.toApiShape());
    } catch (error) {
        if (error.code === 11000) {
            return response.error400(res, msg.SLUG_EXISTS);
        }
        console.error('Create room error:', error.message);
        return response.serverError500(res, msg.CREATE_FAILED, error.message);
    }
};

const getAllRoomsAdmin = async (req, res) => {
    try {
        const { isActive } = req.query;
        const filter = { isDeleted: false };
        if (isActive !== undefined) {
            filter.isActive = isActive === 'true';
        }

        const rooms = await Room.find(filter).sort({ createdAt: -1 }).lean();
        const data = rooms.map((r) => Room.toApiShapeFromLean(r));

        return response.success200(res, msg.ROOMS_RETRIEVED, {
            total: data.length,
            data
        });
    } catch (error) {
        console.error('Get rooms admin error:', error.message);
        return response.serverError500(res, msg.LIST_FAILED, error.message);
    }
};

const getRoomByIdAdmin = async (req, res) => {
    try {
        const room = await Room.findOne(buildRoomLookup(req.params.id));
        if (!room) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }
        return response.success200(res, msg.ROOM_RETRIEVED, room.toApiShape());
    } catch (error) {
        console.error('Get room admin error:', error.message);
        return response.serverError500(res, msg.GET_FAILED, error.message);
    }
};

const updateRoom = async (req, res) => {
    try {
        const existing = await resolveRoom(req.params.id);
        if (!existing) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const { title, slug, type, description, price, currency, guests, quantity, size, unit, amenities, images, isActive } = req.body;
        const updateData = {};

        if (title !== undefined) {
            if (!String(title).trim()) return response.error400(res, msg.TITLE_EMPTY);
            updateData.title = String(title).trim();
        }
        if (slug !== undefined) {
            const uniqueSlug = await ensureUniqueSlug(slug, existing._id);
            if (!uniqueSlug) return response.error400(res, msg.SLUG_REQUIRED);
            updateData.slug = uniqueSlug;
        }
        if (type !== undefined) {
            if (!String(type).trim()) return response.error400(res, msg.TYPE_EMPTY);
            updateData.type = String(type).trim();
        }
        if (description !== undefined) updateData.description = String(description);
        if (price !== undefined) {
            const priceNum = parseFloat(price);
            if (isNaN(priceNum) || priceNum < 0) return response.error400(res, msg.PRICE_REQUIRED);
            updateData.price = priceNum;
        }
        if (currency !== undefined) {
            updateData.currency =
                currency != null && String(currency).trim()
                    ? String(currency).trim().toUpperCase()
                    : 'GHS';
        }
        if (guests !== undefined) {
            const guestsNum = parseInt(guests, 10);
            if (isNaN(guestsNum) || guestsNum < 1) return response.error400(res, msg.GUESTS_MIN);
            updateData.guests = guestsNum;
        }
        if (quantity !== undefined) {
            const quantityNum = parseInt(quantity, 10);
            if (isNaN(quantityNum) || quantityNum < 1) return response.error400(res, msg.QUANTITY_MIN);
            if (quantityNum !== getRoomQuantity(existing)) {
                const bookings = await getAllRoomBlockingBookings(existing._id);
                const quantityCheck = validateRoomQuantityUpdate(existing, bookings, quantityNum);
                if (!quantityCheck.valid) {
                    return response.error400(res, msg.QUANTITY_BELOW_BOOKINGS, null, {
                        maxBookedUnits: quantityCheck.maxBooked,
                        requestedQuantity: quantityNum
                    });
                }
            }
            updateData.quantity = quantityNum;
        }
        if (size !== undefined) {
            const sizeNum = parseFloat(size);
            if (isNaN(sizeNum) || sizeNum < 0) return response.error400(res, msg.SIZE_INVALID);
            updateData.size = sizeNum;
        }
        if (unit !== undefined) {
            updateData.unit = unit != null && String(unit).trim() ? String(unit).trim() : 'sq ft';
        }
        if (amenities !== undefined) {
            updateData.amenities = Array.isArray(amenities)
                ? amenities
                      .filter((a) => a && String(a.name || '').trim() && String(a.icon || '').trim())
                      .map((a) => ({
                          key: a.key ? String(a.key).trim() : '',
                          name: String(a.name).trim(),
                          icon: String(a.icon).trim(),
                          iconType: a.iconType ? String(a.iconType).trim() : 'material'
                      }))
                : [];
        }
        if (images !== undefined) {
            updateData.images = Array.isArray(images)
                ? images
                      .filter((img) => img && String(img.url || '').trim())
                      .map((img, index) => ({
                          url: String(img.url).trim(),
                          order: Number.isFinite(Number(img.order)) ? Number(img.order) : index
                      }))
                : [];
        }
        if (isActive !== undefined) updateData.isActive = !!isActive;

        if (Object.keys(updateData).length === 0) {
            return response.error400(res, msg.NO_FIELDS_TO_UPDATE);
        }

        const room = await Room.findOneAndUpdate(
            { _id: existing._id, isDeleted: false },
            updateData,
            { new: true, runValidators: true }
        );

        if (!room) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        return response.success200(res, msg.ROOM_UPDATED, room.toApiShape());
    } catch (error) {
        if (error.code === 11000) {
            return response.error400(res, msg.SLUG_EXISTS);
        }
        console.error('Update room error:', error.message);
        return response.serverError500(res, msg.UPDATE_FAILED, error.message);
    }
};

const setRoomStatus = async (req, res) => {
    try {
        const existing = await resolveRoom(req.params.id);
        if (!existing) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const { isActive } = req.body;
        if (isActive === undefined) {
            return response.error400(res, msg.IS_ACTIVE_REQUIRED);
        }

        const room = await Room.findOneAndUpdate(
            { _id: existing._id, isDeleted: false },
            { isActive: !!isActive },
            { new: true, runValidators: true }
        );

        if (!room) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const statusMessage = room.isActive ? msg.ROOM_ACTIVATED : msg.ROOM_DEACTIVATED;
        return response.success200(res, statusMessage, room.toApiShape());
    } catch (error) {
        console.error('Set room status error:', error.message);
        return response.serverError500(res, msg.STATUS_FAILED, error.message);
    }
};

const deleteRoom = async (req, res) => {
    try {
        const existing = await resolveRoom(req.params.id);
        if (!existing) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const room = await Room.findOneAndUpdate(
            { _id: existing._id, isDeleted: false },
            { isDeleted: true, isActive: false },
            { new: true }
        );

        if (!room) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        return response.success200(res, msg.ROOM_DELETED, { _id: room._id, slug: room.slug });
    } catch (error) {
        console.error('Delete room error:', error.message);
        return response.serverError500(res, msg.DELETE_FAILED, error.message);
    }
};

const getRoomsForWebsite = async (req, res) => {
    try {
        const stay = parseStayQuery(req.query);

        if (stay.hasStayDates && !stay.validStayDates) {
            return response.error400(res, msg.STAY_DATES_INVALID);
        }

        const filter = { isDeleted: false, isActive: true };
        let rooms = await Room.find(filter).sort({ createdAt: -1 }).lean();

        if (stay.adults) {
            rooms = filterRoomsForStay(rooms, stay);
        }

        const roomIds = rooms.map((r) => r._id);
        const allBookings = roomIds.length
            ? await Booking.find({
                      roomId: { $in: roomIds },
                      isDeleted: false,
                      status: { $in: ['Pending', 'Confirmed', 'Checked-In', 'Checked-Out'] },
                      paymentStatus: { $in: ['paid', 'pending', 'incomplete'] },
                      checkInDate: { $exists: true, $ne: null },
                      checkOutDate: { $exists: true, $ne: null }
                  })
                  .select('roomId roomQuantity bookingReference checkInDate checkOutDate status paymentStatus')
                  .lean()
            : [];

        const bookingsByRoom = {};
        allBookings.forEach((booking) => {
            const key = String(booking.roomId);
            if (!bookingsByRoom[key]) bookingsByRoom[key] = [];
            bookingsByRoom[key].push(booking);
        });

        let shaped = rooms.map((room) =>
            shapeRoomForWebsite(room, bookingsByRoom[String(room._id)] || [], stay)
        );

        if (stay.hasStayDates && stay.validStayDates) {
            shaped = shaped.filter((room) => room.availability.isAvailable);
            if (stay.requestedQuantity) {
                shaped = shaped.filter(
                    (room) => room.availability.availableUnits >= stay.requestedQuantity
                );
            }
        }

        const totalItems = shaped.length;
        const start = (stay.page - 1) * stay.limit;
        const paginated = shaped.slice(start, start + stay.limit);

        return res.status(200).json({
            success: true,
            totalItems,
            page: stay.page,
            limit: stay.limit,
            data: paginated
        });
    } catch (error) {
        console.error('Get website rooms error:', error.message);
        return response.serverError500(res, msg.LIST_FAILED, error.message);
    }
};

const getRoomByIdForWebsite = async (req, res) => {
    try {
        const stay = parseStayQuery(req.query);

        if (stay.hasStayDates && !stay.validStayDates) {
            return response.error400(res, msg.STAY_DATES_INVALID);
        }

        const room = await Room.findOne(buildRoomLookup(req.params.id, { isActive: true })).lean();

        if (!room) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const bookings = await getAllRoomBlockingBookings(room._id);
        const data = shapeRoomForWebsite(room, bookings, stay);

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Get website room error:', error.message);
        return response.serverError500(res, msg.GET_FAILED, error.message);
    }
};

const checkRoomStayAvailability = async (req, res) => {
    try {
        const stay = parseStayQuery(req.query);

        if (!stay.hasStayDates) {
            return response.error400(res, msg.STAY_DATES_REQUIRED);
        }
        if (!stay.validStayDates) {
            return response.error400(res, msg.STAY_DATES_INVALID);
        }
        if (!stay.adults) {
            return response.error400(res, msg.ADULTS_REQUIRED);
        }

        const room = await Room.findOne(buildRoomLookup(req.params.id, { isActive: true })).lean();
        if (!room) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const bookings = await getAllRoomBlockingBookings(room._id);
        const stayEval = evaluateRoomStay(room, bookings, stay);

        const payload = {
            roomId: room._id,
            slug: room.slug,
            name: room.title,
            checkInDate: formatDateKey(stay.checkInDate),
            checkOutDate: formatDateKey(stay.checkOutDate),
            adults: stay.adults,
            children: stay.children,
            nights: stayEval.nights,
            quantity: stayEval.quantity,
            requestedQuantity: stay.requestedQuantity || stayEval.requestedQuantity || 1,
            availableUnits: stayEval.availableUnits,
            bookedUnits: stayEval.bookedUnits,
            pricePerNight: room.price,
            subTotal: stayEval.subTotal,
            totalAmount: stayEval.subTotal,
            currency: room.currency || 'GHS',
            isAvailable: stayEval.isAvailable,
            unavailableReason: stayEval.unavailableReason,
            conflictingBooking: stayEval.conflictingBooking || null
        };

        if (!stayEval.isAvailable) {
            return response.error400(res, msg.ROOM_NOT_AVAILABLE, null, { data: payload });
        }

        return response.success200(res, msg.ROOM_AVAILABLE_FOR_STAY, payload);
    } catch (error) {
        console.error('Check room stay availability error:', error.message);
        return response.serverError500(res, msg.GET_FAILED, error.message);
    }
};

const loadRoomForAvailability = async (req, res) => {
    const room = await Room.findOne(buildRoomLookup(req.params.id, { isActive: true }))
        .select('title slug type blockedDates')
        .lean();
    if (!room) {
        response.notFound404(res, msg.ROOM_NOT_FOUND);
        return null;
    }
    return room;
};

const getRoomAvailability = async (req, res) => {
    try {
        const room = await loadRoomForAvailability(req, res);
        if (!room) return;

        const bookings = await getAllRoomBlockingBookings(room._id);
        const data = buildFullRoomAvailability(room, bookings);

        return response.success200(res, msg.ROOM_AVAILABILITY_RETRIEVED, data);
    } catch (error) {
        console.error('Get room availability error:', error.message);
        return response.serverError500(res, msg.GET_FAILED, error.message);
    }
};

const parseBlockRange = (startDate, endDate, singleDate) => {
    const start = toDateOnly(singleDate || startDate);
    if (!start) return null;

    const endRaw = toDateOnly(endDate);

    // Single calendar date: date only, or startDate === endDate, or endDate omitted
    if (!endRaw || endRaw.getTime() === start.getTime()) {
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { startDate: start, endDate: end };
    }

    if (endRaw < start) return null;
    return { startDate: start, endDate: endRaw };
};

const normalizeBlockInput = (body) => {
    if (Array.isArray(body.blocks) && body.blocks.length > 0) {
        return body.blocks
            .map((block) => {
                const range = parseBlockRange(block.startDate, block.endDate, block.date);
                if (!range) return null;
                return {
                    ...range,
                    reason: block.reason != null ? String(block.reason).trim() : ''
                };
            })
            .filter(Boolean);
    }

    const range = parseBlockRange(body.startDate, body.endDate, body.date);
    if (!range) return null;
    return [
        {
            ...range,
            reason: body.reason != null ? String(body.reason).trim() : ''
        }
    ];
};

const blockRoomDates = async (req, res) => {
    try {
        const existing = await resolveRoom(req.params.id);
        if (!existing) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const blocks = normalizeBlockInput(req.body);
        if (!blocks || blocks.length === 0) {
            if (Array.isArray(req.body.blocks)) {
                return response.error400(res, msg.BLOCK_DATES_INVALID_ITEM);
            }
            if (!req.body.date && !req.body.startDate && !req.body.endDate) {
                return response.error400(res, msg.BLOCK_DATES_REQUIRED);
            }
            return response.error400(res, msg.BLOCK_DATES_INVALID);
        }

        blocks.forEach((block) => {
            existing.blockedDates.push(block);
        });
        await existing.save();

        const { blocked, blockedDates } = getRoomBlockedDateData(existing.blockedDates);

        return response.success200(res, msg.ROOM_DATES_BLOCKED, {
            room: {
                _id: existing._id,
                title: existing.title,
                slug: existing.slug
            },
            added: blocks.map((block) => ({
                startDate: block.startDate,
                endDate: block.endDate,
                reason: block.reason,
                nights: computeNights(block.startDate, block.endDate)
            })),
            blocked,
            blockedDates
        });
    } catch (error) {
        console.error('Block room dates error:', error.message);
        return response.serverError500(res, msg.BLOCK_FAILED, error.message);
    }
};

const getRoomBlockedDates = async (req, res) => {
    try {
        const existing = await resolveRoom(req.params.id);
        if (!existing) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const { blocked, blockedDates } = getRoomBlockedDateData(existing.blockedDates);

        return response.success200(res, msg.BLOCKED_DATES_RETRIEVED, {
            room: {
                _id: existing._id,
                title: existing.title,
                slug: existing.slug
            },
            total: blocked.length,
            blocked,
            blockedDates
        });
    } catch (error) {
        console.error('Get blocked dates error:', error.message);
        return response.serverError500(res, msg.GET_FAILED, error.message);
    }
};

const unblockRoomDates = async (req, res) => {
    try {
        const existing = await resolveRoom(req.params.id);
        if (!existing) {
            return response.notFound404(res, msg.ROOM_NOT_FOUND);
        }

        const blockId = req.params.blockId;
        const block = existing.blockedDates.id(blockId);
        if (!block) {
            return response.notFound404(res, msg.BLOCK_NOT_FOUND);
        }

        const removed = {
            _id: block._id,
            startDate: block.startDate,
            endDate: block.endDate,
            reason: block.reason || ''
        };
        block.deleteOne();
        await existing.save();

        const { blocked, blockedDates } = getRoomBlockedDateData(existing.blockedDates);

        return response.success200(res, msg.ROOM_DATES_UNBLOCKED, {
            room: {
                _id: existing._id,
                title: existing.title,
                slug: existing.slug
            },
            removed,
            blocked,
            blockedDates
        });
    } catch (error) {
        console.error('Unblock room dates error:', error.message);
        return response.serverError500(res, msg.UNBLOCK_FAILED, error.message);
    }
};

module.exports = {
    createRoom,
    getAllRoomsAdmin,
    getRoomByIdAdmin,
    updateRoom,
    setRoomStatus,
    deleteRoom,
    getRoomsForWebsite,
    getRoomByIdForWebsite,
    getRoomAvailability,
    checkRoomStayAvailability,
    blockRoomDates,
    getRoomBlockedDates,
    unblockRoomDates
};
