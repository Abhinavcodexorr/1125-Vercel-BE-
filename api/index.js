require('../app/loadEnv');
require('express');

const createApp = require('../app/createApp');
const app = createApp();

module.exports = app;
