const response = {
    success200: (res, message, data = null) => {
        return res.status(200).json({
            success: true,
            statusCode: 200,
            message: message,
            data: data,
            timestamp: new Date().toISOString()
        });
    },

    created201: (res, message, data = null) => {
        return res.status(201).json({
            success: true,
            statusCode: 201,
            message: message,
            data: data,
            timestamp: new Date().toISOString()
        });
    },

    noContent204: (res, message = "No content") => {
        return res.status(204).json({
            success: true,
            statusCode: 204,
            message: message,
            timestamp: new Date().toISOString()
        });
    },

    error400: (res, message, error = null, meta = null) => {
        const payload = {
            success: false,
            statusCode: 400,
            message: message,
            error: error,
            timestamp: new Date().toISOString()
        };
        if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
            Object.assign(payload, meta);
        }
        return res.status(400).json(payload);
    },

    unauthorized401: (res, message = "Unauthorized access") => {
        return res.status(401).json({
            success: false,
            statusCode: 401,
            message: message,
            timestamp: new Date().toISOString()
        });
    },

    forbidden403: (res, message = "Forbidden access") => {
        return res.status(403).json({
            success: false,
            statusCode: 403,
            message: message,
            timestamp: new Date().toISOString()
        });
    },

    notFound404: (res, message = "Resource not found") => {
        return res.status(404).json({
            success: false,
            statusCode: 404,
            message: message,
            timestamp: new Date().toISOString()
        });
    },

    validationError422: (res, message, errors = null) => {
        return res.status(422).json({
            success: false,
            statusCode: 422,
            message: message,
            errors: errors,
            timestamp: new Date().toISOString()
        });
    },

    error423: (res, message = "Resource is locked") => {
        return res.status(423).json({
            success: false,
            statusCode: 423,
            message: message,
            timestamp: new Date().toISOString()
        });
    },

    serverError500: (res, message = "Internal server error", error = null) => {
        return res.status(500).json({
            success: false,
            statusCode: 500,
            message: message,
            error: error,
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = response;