const Subscribe = require('./subscribeModel');
const response = require('../../helper/response');
const msg = require('./subscribeMessages');

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const subscribe = async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);

        if (!email) {
            return response.error400(res, msg.EMAIL_REQUIRED);
        }
        if (!EMAIL_REGEX.test(email)) {
            return response.error400(res, msg.EMAIL_INVALID);
        }

        const existing = await Subscribe.findOne({ email });
        if (existing && !existing.isDeleted) {
            return response.error400(res, msg.ALREADY_SUBSCRIBED);
        }

        if (existing && existing.isDeleted) {
            existing.isDeleted = false;
            existing.source = req.body.source || existing.source || 'website';
            await existing.save();
            return response.success200(res, msg.SUBSCRIBE_SUCCESS, existing.getFormatted());
        }

        const subscriber = new Subscribe({
            email,
            source: req.body.source || 'website'
        });
        await subscriber.save();

        return response.created201(res, msg.SUBSCRIBE_SUCCESS, subscriber.getFormatted());
    } catch (error) {
        if (error.code === 11000) {
            return response.error400(res, msg.ALREADY_SUBSCRIBED);
        }
        console.error('Subscribe error:', error.message);
        return response.serverError500(res, 'Failed to subscribe', error.message);
    }
};

const listSubscribersAdmin = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const search = normalizeEmail(req.query.search || req.query.email || '');

        const filter = { isDeleted: { $ne: true } };
        if (search) {
            filter.email = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        }

        const [total, subscribers] = await Promise.all([
            Subscribe.countDocuments(filter),
            Subscribe.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
        ]);

        return res.status(200).json({
            success: true,
            statusCode: 200,
            message: total ? msg.LIST_SUCCESS : msg.LIST_EMPTY,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 0,
            data: subscribers.map((s) => s.getFormatted()),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('List subscribers error:', error.message);
        return response.serverError500(res, 'Failed to retrieve subscribers', error.message);
    }
};

module.exports = {
    subscribe,
    listSubscribersAdmin
};
