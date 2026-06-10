const AWS = require('aws-sdk');
const moment = require('moment');
const response = require('../../helper/response');
const msg = require('./uploadMessages');
const { getAwsConfig } = require('../../config/aws.config');

let s3Client = null;
let cachedConfig = null;

const getS3 = () => {
    const config = getAwsConfig();
    if (
        !config.accessKey ||
        !config.secretKey ||
        !config.bucket ||
        !config.region
    ) {
        return { s3: null, config };
    }

    if (
        !s3Client ||
        !cachedConfig ||
        cachedConfig.accessKey !== config.accessKey ||
        cachedConfig.secretKey !== config.secretKey ||
        cachedConfig.region !== config.region
    ) {
        s3Client = new AWS.S3({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKey,
                secretAccessKey: config.secretKey
            }
        });
        cachedConfig = config;
    }

    return { s3: s3Client, config };
};

const buildPublicUrl = (config, folder, fileName) => {
    if (config.endpoint) {
        const base = config.endpoint.replace(/\/$/, '');
        return `${base}/${folder}/${fileName}`;
    }
    return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${folder}/${fileName}`;
};

const generate_file_name = async (file_name) => {
    const current_millis = moment().format('x');
    const raw_file_name = file_name.split(/\s/).join('');
    const split_file = raw_file_name.split('.');
    const split_all = split_file[0].split(/[^a-zA-Z0-9]/g).join('_');
    const name = split_all.toLowerCase();
    const ext = split_file[1] || 'jpg';
    return `${name}_${current_millis}.${ext}`.toLowerCase();
};

const upload_file_to_s3 = (s3, config, file_name, folder, mime_type, buffer) =>
    new Promise((resolve, reject) => {
        const params = {
            Bucket: config.bucket,
            Key: `${folder}/${file_name}`,
            Body: buffer,
            ContentType: mime_type
        };
        s3.putObject(params, (err) => {
            if (err) return reject(err);
            resolve({ Location: buildPublicUrl(config, folder, file_name) });
        });
    });

const upload_images = async (s3, config, file_name, folder, buffer, mime_type) => {
    const uploadResponse = await upload_file_to_s3(s3, config, file_name, folder, mime_type, buffer);
    return {
        file_url: uploadResponse.Location,
        file_name
    };
};

const normalizeUploadFiles = (filesInput) => {
    if (!filesInput) return [];
    return Array.isArray(filesInput) ? filesInput : [filesInput];
};

const assertS3Ready = (res) => {
    const { s3, config } = getS3();
    if (!s3) {
        response.serverError500(res, msg.AWS_CONFIG_MISSING, {
            missing: {
                AWS_ACCESS_KEY: !config.accessKey,
                AWS_SECRET_KEY: !config.secretKey,
                BUCKET_NAME: !config.bucket,
                AWS_REGION: !config.region
            }
        });
        return null;
    }
    return { s3, config };
};

exports.upload_file = async (req, res) => {
    try {
        const s3Ready = assertS3Ready(res);
        if (!s3Ready) return;
        const { s3, config } = s3Ready;

        if (!req.files || !req.files.files) {
            return response.error400(res, msg.NO_FILE);
        }

        const fileList = normalizeUploadFiles(req.files.files);
        const { name, data, mimetype } = fileList[0];
        const split_mime_type = mimetype.split('/');

        if (split_mime_type[0] !== 'image') {
            return response.error400(res, msg.UNSUPPORTED_TYPE);
        }

        const file_name = await generate_file_name(name);
        const uploadResponse = await upload_images(s3, config, file_name, 'images', data, mimetype);
        return response.success200(res, msg.UPLOAD_SUCCESS, uploadResponse);
    } catch (err) {
        console.error('Upload error:', err);
        return response.serverError500(res, msg.UPLOAD_FAILED, err.message);
    }
};

exports.upload_room_images = async (req, res) => {
    try {
        const s3Ready = assertS3Ready(res);
        if (!s3Ready) return;
        const { s3, config } = s3Ready;

        if (!req.files || !req.files.files) {
            return response.error400(res, msg.NO_FILE);
        }

        const fileList = normalizeUploadFiles(req.files.files);
        const orderStart = parseInt(req.body?.order, 10);
        const startOrder = Number.isFinite(orderStart) && orderStart >= 0 ? orderStart : 0;
        const uploaded = [];

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const mimeParts = file.mimetype.split('/');
            if (mimeParts[0] !== 'image') {
                return response.error400(res, msg.UNSUPPORTED_TYPE);
            }
            const file_name = await generate_file_name(file.name);
            const result = await upload_images(s3, config, file_name, 'rooms', file.data, file.mimetype);
            uploaded.push({
                url: result.file_url,
                file_name: result.file_name,
                order: startOrder + i
            });
        }

        return response.success200(res, msg.ROOM_IMAGES_SUCCESS, {
            total: uploaded.length,
            images: uploaded
        });
    } catch (err) {
        console.error('Room image upload error:', err);
        return response.serverError500(res, msg.UPLOAD_FAILED, err.message);
    }
};
