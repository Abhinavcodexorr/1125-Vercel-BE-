const response = require('../../helper/response');
const sendEmail = require('../../middleware/mail');

// Create contact form submission and send email notification
const createContact = async (req, res) => {
    try {
        const { message, query } = req.body;

        const messageContent = message || query;

        if (!messageContent || !messageContent.trim()) {
            return response.error400(res, "Message or query is required");
        }

        try {
            const emailSubject = `New Enquiry Raised`;
            const emailMessage = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                            color: #333;
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                        }
                        .header {
                            background-color: #133730;
                            color: white;
                            padding: 15px;
                            text-align: center;
                            border-radius: 5px 5px 0 0;
                            border: 4px solid #1a3d1b;
                        }
                        .header h1 {
                            font-size: 18px;
                            margin: 0;
                            font-weight: 600;
                        }
                        .content {
                            background-color: #f9f9f9;
                            padding: 30px;
                            border: 1px solid #ddd;
                        }
                        .message-box {
                            background-color: white;
                            padding: 20px;
                            margin: 20px 0;
                            border-radius: 5px;
                            border-left: 4px solid #2c5f2d;
                            min-height: 100px;
                        }
                        .message-content {
                            color: #333;
                            font-size: 15px;
                            line-height: 1.8;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                        }
                        .info-box {
                            background-color: #e8f5e9;
                            border: 1px solid #2c5f2d;
                            padding: 10px;
                            margin: 20px 0;
                            border-radius: 5px;
                        }
                        .info-label {
                            font-weight: bold;
                            color: #2c5f2d;
                            margin-right: 10px;
                        }
                        .footer {
                            text-align: center;
                            padding: 20px;
                            color: #666;
                            font-size: 12px;
                            border-top: 1px solid #ddd;
                            margin-top: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>New Enquiry Received</h1>
                    </div>
                    <div class="content">
                        
                        
                        <div class="message-box">
                            <h3 style="margin-top: 0; color: #2c5f2d;">Message:</h3>
                            <div class="message-content">${messageContent.trim().replace(/\n/g, '<br>')}</div>
                        </div>
                        
                        <div class="info-box">
                            <div style="margin-bottom: 10px;">
                                <span class="info-label">Submitted on:</span>
                                <span>${new Date().toLocaleString('en-US', { 
                                    year: 'numeric', 
                                    month: 'long', 
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: true,
                                    timeZone: 'UTC'
                                })} UTC</span>
                            </div>
                        </div>
                        
                        
                        
                        
                    </div>
                    
                    <div class="footer">
                        <p>This is an automated email from Palm Island Resort contact form.</p>
                        <p>&copy; ${new Date().getFullYear()} Palm Island Resort. All rights reserved.</p>
                    </div>
                </body>
                </html>
            `;

            const recipients = ['info@palmislandgh.com'];
            
            const emailPromises = recipients.map(email => 
                sendEmail({
                    to: email,
                    subject: emailSubject,
                    message: emailMessage
                })
            );
            
            await Promise.all(emailPromises);

            const contactSuccessMessage =
                "Thank you for getting in touch! We've received your message and one of our team members will contact you soon.";

            return response.created201(res, contactSuccessMessage, {
                message: contactSuccessMessage
            });
        } catch (emailError) {
            console.error('Failed to send email:', emailError);
            return response.serverError500(res, "Failed to send message", emailError.message);
        }
    } catch (error) {
        console.error('Error creating contact:', error);
        return response.serverError500(res, "Failed to send message", error.message);
    }
};

// Get all contact messages with pagination
const getAllMessages = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const query = { isDeleted: false };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const messages = await Contact.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Contact.countDocuments(query);

        return response.success200(res, "Messages retrieved successfully", {
            messages,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error getting messages:', error);
        return response.serverError500(res, "Failed to retrieve messages", error.message);
    }
};

module.exports = {
    createContact,
    getAllMessages
};

