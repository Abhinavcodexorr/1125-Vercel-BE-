require('dotenv').config();

const stripEnv = (value) => {
    if (value == null) return '';
    return String(value).replace(/^['"]|['"]$/g, '').trim();
};

const pick = (keys, fallback = '') => {
    for (const key of keys) {
        const value = stripEnv(process.env[key]);
        if (value) return value;
    }
    return fallback;
};

/** Keys must come from env (.env locally, Vercel Environment Variables in production). */
const getAwsConfig = () => ({
    accessKey: pick(['AWS_ACCESS_KEY', 'AWS_ACCESS_KEY_ID']),
    secretKey: pick(['AWS_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY']),
    bucket: pick(['BUCKET_NAME'], 'palmisland'),
    region: pick(['AWS_REGION'], 'eu-north-1'),
    endpoint: pick(['AWS_ENDPOINT'], 'https://palmisland.s3.eu-north-1.amazonaws.com')
});

module.exports = { getAwsConfig };
