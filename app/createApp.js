const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const ratelimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const logger = require('./helper/logger.js');
const routes = require('./modules/router.js');
const connectDB = require('./bootstrap');

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
    'https://palm-island-resort-fe-one.vercel.app',
    'https://api1125.vercel.app',
    'https://api.geoapify.com',
    'http://13.49.45.25/'
];

const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true;
    return false;
};

const createApp = () => {
    const app = express();
    const port = process.env.PORT || 3001;

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

    const swaggerDefinition = {
        openapi: '3.0.0',
        info: {
            title: '1125 API',
            version: '1.0.0',
            description: '1125 backend API documentation'
        },
        servers: [
            {
                url: process.env.VERCEL_URL
                    ? `https://${process.env.VERCEL_URL}`
                    : `http://localhost:${port}`
            }
        ]
    };

    const swaggerSpec = swaggerJsdoc({
        swaggerDefinition,
        apis: ['./routes/*.js']
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
    app.use('/uploads', express.static(path.join(__dirname, 'modules/uploads')));

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

    app.use(async (req, res, next) => {
        try {
            await connectDB();
            next();
        } catch (err) {
            console.error('Database connection failed:', err.message);
            return res.status(503).json({
                success: false,
                message: 'Database connection failed. Check MONGO_URI on the server.',
                error: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
    });

    app.use(routes);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

    return app;
};

module.exports = createApp;
