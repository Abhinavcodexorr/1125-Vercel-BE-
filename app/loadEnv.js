const path = require('path');
const fs = require('fs');

const env = process.env.NODE_ENV || 'production';
let envFile = '.env';

if (env !== 'production' && env !== 'prod') {
    envFile = fs.existsSync(path.resolve(__dirname, '../.env.development'))
        ? '.env.development'
        : '.env';
}

const envPath = path.resolve(__dirname, '..', envFile);
if (!process.env.RENDER && fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

module.exports = envFile;
