/**
 * Single source for public API base URLs (website / data loading).
 * Override with BASE_URL in .env for local testing.
 */
const PRODUCTION_BASE_URL = 'https://api1125.vercel.app';

const trimTrailingSlash = (url) => String(url || '').trim().replace(/\/+$/, '');

const normalizeApiPath = (path) => {
    const raw = String(path || '/api/v1').trim().replace(/\\/g, '/');
    const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
    return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
};

const BASE_URL = trimTrailingSlash(
    process.env.BASE_URL || process.env.PUBLIC_API_BASE_URL || PRODUCTION_BASE_URL
);

const API_PATH = normalizeApiPath(process.env.API_URL || '/api/v1/');
const API_BASE_URL = `${BASE_URL}${API_PATH.replace(/\/$/, '')}`;

/** Build full API URL: joinApi('rooms') → https://api1125.vercel.app/api/v1/rooms */
const joinApi = (segment = '') => {
    const path = String(segment).replace(/^\/+/, '');
    return path ? `${API_BASE_URL}/${path}` : API_BASE_URL;
};

module.exports = {
    PRODUCTION_BASE_URL,
    BASE_URL,
    API_PATH,
    API_BASE_URL,
    joinApi
};
