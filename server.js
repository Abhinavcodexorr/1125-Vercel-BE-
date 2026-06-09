const express = require('express');
const path = require('path');
const fs = require('fs');

const env = process.env.NODE_ENV || 'production';
let envFile;
if (env === 'production' || env === 'prod') {
  envFile = '.env';
} else {
  envFile = fs.existsSync(path.resolve(__dirname, '.env.development')) ? '.env.development' : '.env';
}
const dotenv = require('dotenv').config({path: path.resolve(__dirname, envFile)});
console.log(`📁 Loading environment file: ${envFile}`);
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const ratelimit = require('express-rate-limit');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const app = express();
const logger = require('./app/helper/logger.js')
const routes = require('./app/modules/router.js');
const superAdminController = require('./app/modules/SuperAdmin/superAdminController');

// const Config = require('./app/config/auth.config');


// Check Envrionment Running

console.log(" Envrionment : ", process.env.NODE_ENV);
const HOST = "localhost";
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
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
  'https://palm-island-resort-fe-one.vercel.app', // ✅ correct version
  'https://api.geoapify.com',
  'http://13.49.45.25/'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('❌ Blocked by CORS:', origin);
      callback(new Error('CORS not allowed for this origin'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
}));



// Setup rate limit
const limiter = ratelimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
})


// Swagger definition
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'A simple API documentation',
  },
  servers: [
    {
      url: `http://localhost:${PORT}`,
    },
  ],
};


// Options for swagger-jsdoc
const options = {
  swaggerDefinition,
  apis: ['./routes/*.js'], // Path to the API 
};


// Initialize swagger-jsdoc
const swaggerSpec = swaggerJsdoc(options);
// logger setup 
const morganFormat = ":method :url :status :response-time ms";


// Morgan middleware to capture errors and log them separately
app.use(
  morgan(morganFormat, {
    skip: (req, res) => res.statusCode < 400, // Only log errors
    stream: {
      write: (message) => {
        const logObject = {
          method: message.split(" ")[0],
          url: message.split(" ")[1],
          status: message.split(" ")[2],
          responseTime: message.split(" ")[3],
        };
        logger.error(JSON.stringify(logObject));
      },
    },
  })
);

// Morgan middleware to log success  separately
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => {
        const logObject = {
          method: message.split(" ")[0],
          url: message.split(" ")[1],
          status: message.split(" ")[2],
          responseTime: message.split(" ")[3],
        };
        logger.info(JSON.stringify(logObject));
      },
    },
  })
);


// Enable rate limit
app.use(limiter)
//Enable helmet
app.use(helmet())
app.use(express.json({ limit: '100mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads',express.static(path.join(__dirname, 'app/modules/uploads')));
app.use(routes);
// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Palm Island.' });
});

// Mongoose connection
const dbConfig = require("./app/config/db.config");
const mongoose = require('mongoose');
console.log("DB URL:" +dbConfig.url )

mongoose.connect(dbConfig.url, {
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log(`\n MongoDB connected !! DB HOST ${HOST}:27017\n`);

    const Booking = require('./app/modules/Booking/bookingModel');
    try {
      await Booking.syncIndexes();
    } catch (syncErr) {
      console.warn('[DB] Booking.syncIndexes:', syncErr.message);
    }

    // Create default superadmin if not exists
    await superAdminController.createDefaultSuperAdmin();
  })
  .catch(err => {
    console.error("Cannot connect to the database!", err);
    process.exit();
  });


// Start the server
const server = app.listen(PORT, () => {
  console.log(`⚙️  Server is running at port :${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop other dev servers, then run: npm run dev`);
    process.exit(1);
  }
  throw err;
});
