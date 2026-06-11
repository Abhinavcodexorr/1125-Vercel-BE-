const envFile = require('./app/loadEnv');
const createApp = require('./app/createApp');
const connectDB = require('./app/bootstrap');

console.log(`Loading environment file: ${envFile}`);
console.log('Environment:', process.env.NODE_ENV);

const PORT = process.env.PORT || 3002;
const app = createApp();

connectDB()
    .then(() => {
        console.log('MongoDB connected');
        const server = app.listen(PORT, () => {
            console.log(`Server is running at port :${PORT}`);
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
