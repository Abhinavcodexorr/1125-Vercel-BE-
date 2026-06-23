const ENQUIRY_EMAIL_SUBJECT = 'Enquiry Raised';
const ENQUIRY_RECIPIENT = 'info@1125beachvilla.com';
const BRAND_COLOR = '#5a8aad';
const BRAND_COLOR_LIGHT = '#eef4f8';
const BRAND_COLOR_DARK = '#4a7596';

const escapeHtml = (value) =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const formatSubmittedDate = (date = new Date()) =>
    new Date(date).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

const buildEnquiryEmailHtml = ({ name, email, message, submittedAt }) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${ENQUIRY_EMAIL_SUBJECT}</title>
    <style>
        body, table, td, p, a {
            -webkit-text-size-adjust: 100%;
            -ms-text-size-adjust: 100%;
        }
        table, td {
            mso-table-lspace: 0;
            mso-table-rspace: 0;
            border-collapse: collapse;
        }
        img {
            border: 0;
            outline: none;
            text-decoration: none;
        }
        body {
            margin: 0;
            padding: 0;
            width: 100% !important;
            background-color: #f4f6f8;
            font-family: Arial, Helvetica, sans-serif;
            color: #333333;
        }
        .email-wrapper {
            width: 100%;
            background-color: #f4f6f8;
            padding: 24px 12px;
        }
        .email-container {
            width: 100%;
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
        }
        .header {
            background-color: ${BRAND_COLOR};
            color: #ffffff;
            text-align: center;
            padding: 24px 20px;
        }
        .header-title {
            margin: 0;
            font-size: 22px;
            line-height: 1.3;
            font-weight: 700;
            letter-spacing: 0.3px;
        }
        .content {
            padding: 24px 20px;
        }
        .section-title {
            margin: 0 0 12px 0;
            font-size: 13px;
            font-weight: 700;
            color: ${BRAND_COLOR};
            text-transform: uppercase;
            letter-spacing: 0.6px;
        }
        .details-box {
            background-color: ${BRAND_COLOR_LIGHT};
            border: 1px solid ${BRAND_COLOR};
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 20px;
        }
        .detail-label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            color: ${BRAND_COLOR_DARK};
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        .detail-value {
            display: block;
            font-size: 15px;
            line-height: 1.5;
            color: #333333;
            margin-bottom: 14px;
            word-break: break-word;
        }
        .detail-value:last-child {
            margin-bottom: 0;
        }
        .detail-value a {
            color: ${BRAND_COLOR};
            text-decoration: none;
        }
        .message-box {
            border: 1px solid #d9e2ea;
            border-left: 4px solid ${BRAND_COLOR};
            border-radius: 6px;
            padding: 16px;
            background-color: #ffffff;
        }
        .message-content {
            margin: 0;
            font-size: 15px;
            line-height: 1.7;
            color: #333333;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .footer {
            background-color: #fafbfc;
            border-top: 1px solid #e5ebf0;
            text-align: center;
            padding: 18px 20px;
        }
        .footer p {
            margin: 4px 0;
            font-size: 12px;
            line-height: 1.5;
            color: #666666;
        }
        .footer-brand {
            color: ${BRAND_COLOR};
            font-weight: 600;
        }
        @media only screen and (max-width: 620px) {
            .email-wrapper {
                padding: 12px 8px !important;
            }
            .header {
                padding: 20px 16px !important;
            }
            .header-title {
                font-size: 20px !important;
            }
            .content {
                padding: 20px 16px !important;
            }
            .details-box,
            .message-box {
                padding: 14px !important;
            }
            .detail-value {
                font-size: 14px !important;
            }
            .message-content {
                font-size: 14px !important;
            }
        }
    </style>
</head>
<body>
    <div class="email-wrapper">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
                <td align="center">
                    <table role="presentation" class="email-container" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                            <td class="header">
                                <h1 class="header-title">Enquiry Raised</h1>
                            </td>
                        </tr>
                        <tr>
                            <td class="content">
                                <p class="section-title">Contact Details</p>
                                <div class="details-box">
                                    <span class="detail-label">Name</span>
                                    <span class="detail-value">${escapeHtml(name)}</span>
                                    <span class="detail-label">Email</span>
                                    <span class="detail-value"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></span>
                                    <span class="detail-label">Date</span>
                                    <span class="detail-value">${formatSubmittedDate(submittedAt)}</span>
                                </div>
                                <p class="section-title">Message</p>
                                <div class="message-box">
                                    <p class="message-content">${escapeHtml(message).replace(/\n/g, '<br>')}</p>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td class="footer">
                                <p class="footer-brand">1125 Beach Villa</p>
                                <p>This is an automated email from the contact enquiry form.</p>
                                <p>&copy; ${new Date().getFullYear()} 1125 Beach Villa. All rights reserved.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </div>
</body>
</html>`;

const getInquiryRecipient = () => ENQUIRY_RECIPIENT;

module.exports = {
    ENQUIRY_EMAIL_SUBJECT,
    ENQUIRY_RECIPIENT,
    buildEnquiryEmailHtml,
    getInquiryRecipient
};
