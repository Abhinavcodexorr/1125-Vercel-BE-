/**
 * Vercel entrypoint — must directly require("express") for Vercel's Express builder.
 * Local dev and Render use server.js (calls listen).
 */
require('./app/loadEnv');
require('express');

const createApp = require('./app/createApp');
const app = createApp();

module.exports = app;
