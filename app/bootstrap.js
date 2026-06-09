const mongoose = require('mongoose');
const dbConfig = require('./config/db.config');

let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null, initialized: false };
}

const connectDB = async () => {
    const mongoUrl = dbConfig.url;

    if (process.env.VERCEL && (!mongoUrl || /127\.0\.0\.1|localhost/.test(mongoUrl))) {
        throw new Error('MONGO_URI must be set to a MongoDB Atlas connection string on Vercel');
    }

    if (cached.conn) {
        return cached.conn;
    }

    if (!cached.promise) {
        cached.promise = mongoose
            .connect(mongoUrl, {
                serverSelectionTimeoutMS: 10000,
                bufferCommands: false
            })
            .then((m) => m);
    }

    cached.conn = await cached.promise;

    if (!cached.initialized) {
        cached.initialized = true;

        const Booking = require('./modules/Booking/bookingModel');
        try {
            await Booking.syncIndexes();
        } catch (syncErr) {
            console.warn('[DB] Booking.syncIndexes:', syncErr.message);
        }

        const superAdminController = require('./modules/SuperAdmin/superAdminController');
        await superAdminController.createDefaultSuperAdmin();
    }

    return cached.conn;
};

module.exports = connectDB;
