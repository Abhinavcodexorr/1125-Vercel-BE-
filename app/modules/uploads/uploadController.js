const AWS = require('aws-sdk');
const moment = require('moment');
const response = require('../../helper/response');
const msg = require('./uploadMessages');

const stripEnv = (value) => {
    if (value == null) return '';
    return String(value).replace(/^['"]|['"]$/g, '').trim();
};

const aws_access_key = stripEnv(process.env.AWS_ACCESS_KEY);
const aws_secret_key = stripEnv(process.env.AWS_SECRET_KEY);
const aws_bucket_name = stripEnv(process.env.BUCKET_NAME);
const aws_region = stripEnv(process.env.AWS_REGION);
const aws_endpoint = stripEnv(process.env.AWS_ENDPOINT);

const s3Configured = !!(aws_access_key && aws_secret_key && aws_bucket_name && aws_region);

if (!s3Configured) {
    console.error('AWS S3 Configuration Missing');
}

const s3 = s3Configured
    ? new AWS.S3({
          region: aws_region,
          credentials: {
              accessKeyId: aws_access_key,
              secretAccessKey: aws_secret_key
          }
      })
    : null;

const buildPublicUrl = (folder, fileName) => {
    if (aws_endpoint) {
        const base = aws_endpoint.replace(/\/$/, '');
        return `${base}/${folder}/${fileName}`;
    }
    return `https://${aws_bucket_name}.s3.${aws_region}.amazonaws.com/${folder}/${fileName}`;
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

const upload_file_to_s3 = (file_name, folder, mime_type, buffer) =>
    new Promise((resolve, reject) => {
        const params = {
            Bucket: aws_bucket_name,
            Key: `${folder}/${file_name}`,
            Body: buffer,
            ContentType: mime_type
        };
        s3.putObject(params, (err) => {
            if (err) return reject(err);
            resolve({ Location: buildPublicUrl(folder, file_name) });
        });
    });

const upload_images = async (file_name, folder, buffer, mime_type) => {
    const uploadResponse = await upload_file_to_s3(file_name, folder, mime_type, buffer);
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
    if (!s3Configured || !s3) {
        response.serverError500(res, msg.AWS_CONFIG_MISSING, {
            missing: {
                AWS_ACCESS_KEY: !aws_access_key,
                AWS_SECRET_KEY: !aws_secret_key,
                BUCKET_NAME: !aws_bucket_name,
                AWS_REGION: !aws_region
            }
        });
        return false;
    }
    return true;
};

exports.upload_file = async (req, res) => {
    try {
        if (!assertS3Ready(res)) return;

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
        const uploadResponse = await upload_images(file_name, 'images', data, mimetype);
        return response.success200(res, msg.UPLOAD_SUCCESS, uploadResponse);
    } catch (err) {
        console.error('Upload error:', err);
        return response.serverError500(res, msg.UPLOAD_FAILED, err.message);
    }
};

exports.upload_room_images = async (req, res) => {
    try {
        if (!assertS3Ready(res)) return;

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
            const result = await upload_images(file_name, 'rooms', file.data, file.mimetype);
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
