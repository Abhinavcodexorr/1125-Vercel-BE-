const path = require('path');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const ratelimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');

const env = process.env.NODE_ENV || 'production';
let envFile = '.env';
if (env !== 'production' && env !== 'prod') {
    envFile = fs.existsSync(path.resolve(__dirname, '.env.development'))
        ? '.env.development'
        : '.env';
}
require('dotenv').config({ path: path.resolve(__dirname, envFile) });

const logger = require('./app/helper/logger.js');
const routes = require('./app/modules/router.js');
const dbConfig = require('./app/config/db.config');

const PORT = process.env.PORT || 3002;

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
    'http://localhost:4200',
    'http://192.168.1.48:3001',
    'http://35.160.43.15',
    'http://54.180.128.53',
    'http://54.180.128.53:3001',
    'http://65.1.93.105',
    'https://65.1.93.105',
    'http://13.235.80.157',
    'https://api.palmislandgh.com',
    'https://www.palmislandgh.com',
    'https://palmislandgh.com',
    'https://api.geoapify.com',
    'http://13.49.45.25/',
    'https://1125-vercel-fe.vercel.app/'
];

const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    return allowedOrigins.includes(origin);
};

const app = express();
app.set('trust proxy', 1);

app.use(
    cors({
        origin: (origin, callback) => {
            if (isAllowedOrigin(origin)) {
                callback(null, true);
            } else {
                console.log('Blocked by CORS:', origin);
                callback(new Error('CORS not allowed for this origin'));
            }
        },
        credentials: true,
        optionsSuccessStatus: 200
    })
);

const limiter = ratelimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    message: 'Too many requests from this IP, please try again later.'
});

const swaggerSpec = swaggerJsdoc({
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: '1125 API',
            version: '1.0.0',
            description: '1125 backend API documentation'
        },
        servers: [
            {
                url: process.env.API_PUBLIC_URL || `http://localhost:${PORT}`
            }
        ]
    },
    apis: ['./app/modules/**/*.js']
});

const morganFormat = ':method :url :status :response-time ms';

app.use(
    morgan(morganFormat, {
        skip: (req, res) => res.statusCode < 400,
        stream: {
            write: (message) => {
                const parts = message.trim().split(' ');
                logger.error(
                    JSON.stringify({
                        method: parts[0],
                        url: parts[1],
                        status: parts[2],
                        responseTime: parts[3]
                    })
                );
            }
        }
    })
);

app.use(
    morgan(morganFormat, {
        stream: {
            write: (message) => {
                const parts = message.trim().split(' ');
                logger.info(
                    JSON.stringify({
                        method: parts[0],
                        url: parts[1],
                        status: parts[2],
                        responseTime: parts[3]
                    })
                );
            }
        }
    })
);

app.use(limiter);
app.use(helmet());
app.use(express.json({ limit: '100mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'app/modules/uploads')));

app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        service: '1125-api',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to 1125 API',
        apiBase: '/api/v1',
        health: '/health'
    });
});

app.use(routes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

let dbInitialized = false;

const connectDB = async () => {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    await mongoose.connect(dbConfig.url, {
        serverSelectionTimeoutMS: 10000
    });

    if (!dbInitialized) {
        dbInitialized = true;

        const Booking = require('./app/modules/Booking/bookingModel');
        try {
            await Booking.syncIndexes();
        } catch (syncErr) {
            console.warn('[DB] Booking.syncIndexes:', syncErr.message);
        }

        const superAdminController = require('./app/modules/SuperAdmin/superAdminController');
        await superAdminController.createDefaultSuperAdmin();
    }

    return mongoose.connection;
};

console.log(`Loading environment file: ${envFile}`);
console.log('Environment:', process.env.NODE_ENV);

connectDB()
    .then(() => {
        console.log('MongoDB connected');
        const host = process.env.HOST || '0.0.0.0';
        const server = app.listen(PORT, host, () => {
            console.log(`Server is running at http://${host}:${PORT}`);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use. Stop other dev servers, then run: npm start`);
                process.exit(1);
            }
            throw err;
        });
    })
    .catch((err) => {
        console.error('Cannot connect to the database!', err);
        process.exit(1);
    });
