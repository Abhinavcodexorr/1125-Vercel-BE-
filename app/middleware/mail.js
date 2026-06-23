const axios = require('axios');
// Environment variables are loaded in server.js

// Mailgun API Configuration — set values in .env (not committed to git)
// Clean environment variables to remove quotes, semicolons, and extra whitespace
const cleanEnvVar = (value, defaultValue) => {
  if (!value) return defaultValue;
  return value.trim().replace(/['";]/g, '');
};

const mailgunApiKey = cleanEnvVar(process.env.MAILGUN_API_KEY, '');
const mailgunDomain = cleanEnvVar(process.env.MAILGUN_DOMAIN, '');
const mailgunBaseUrl = cleanEnvVar(process.env.MAILGUN_BASE_URL, 'https://api.mailgun.net');
const fromEmail = cleanEnvVar(process.env.FROM_EMAIL, '');
const defaultFromName = cleanEnvVar(process.env.FROM_NAME, '1125 Beach Villa');

// Helper function to construct Mailgun URL safely
const getMailgunUrl = () => {
  // Clean and sanitize environment variables
  let baseUrl = (mailgunBaseUrl || '').trim();
  let domain = (mailgunDomain || '').trim();
  
  // Remove quotes, semicolons, and other unwanted characters
  baseUrl = baseUrl.replace(/['";]/g, '').replace(/\/$/, ''); // Remove quotes, semicolons, and trailing slash
  domain = domain.replace(/['";]/g, ''); // Remove quotes and semicolons
  
  if (!baseUrl || !domain) {
    throw new Error('MAILGUN_BASE_URL and MAILGUN_DOMAIN must be set');
  }
  
  // Ensure baseUrl doesn't have trailing slash
  baseUrl = baseUrl.replace(/\/+$/, '');
  
  const url = `${baseUrl}/v3/${domain}/messages`;
  
  // Validate URL format
  try {
    new URL(url);
    return url;
  } catch (urlError) {
    console.error('URL construction failed:', {
      baseUrl: baseUrl,
      domain: domain,
      constructedUrl: url
    });
    throw new Error(`Invalid Mailgun URL format: ${url}`);
  }
};

// Send email using Mailgun API via HTTP request
const sendEmail = async (options) => {
  try {
    // Validate required options
    if (!options || !options.to || !options.subject || !options.message) {
      throw new Error('Missing required email options: to, subject, or message');
    }

    // Validate Mailgun configuration
    if (!mailgunApiKey || !mailgunDomain || !mailgunBaseUrl) {
      throw new Error('Mailgun configuration is incomplete. Please check environment variables.');
    }

    // Get and validate URL
    const mailgunUrl = getMailgunUrl();
    
    // Log URL for debugging (masked for security)
    console.log('Mailgun URL:', mailgunUrl.replace(/\/v3\/[^\/]+/, '/v3/[DOMAIN]'));

    // Create form-urlencoded data for Mailgun API
    const params = new URLSearchParams();
    const senderName = options.fromName || defaultFromName;
    params.append('from', `${senderName} <${fromEmail}>`);
    params.append('to', options.to);
    params.append('subject', options.subject);
    params.append('html', options.message);
    
    // Add BCC if provided
    if (options.bcc) {
        params.append('bcc', options.bcc);
    }

    // Make API request to Mailgun
    const response = await axios.post(mailgunUrl, params.toString(), {
      auth: {
        username: 'api',
        password: mailgunApiKey
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Email sent successfully via Mailgun:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending email via Mailgun:', {
      message: error.message,
      response: error.response?.data,
      url: error.config?.url,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

  module.exports = sendEmail;


