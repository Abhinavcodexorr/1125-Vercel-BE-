module.exports = {
    mongoURL: process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/1125",
    API_URL: process.env.API_URL || "/api/v1/",
    JWTSECRET: process.env.JWT_SECRET || "your-secret-key",
    /** Admin panel JWT lifetime (not express-session; revoked via logout / password change). */
    ADMIN_JWT_EXPIRES_IN: process.env.ADMIN_JWT_EXPIRES_IN || "30d",
};
