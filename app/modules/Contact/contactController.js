const Contact = require('./contactModel');
const response = require('../../helper/response');
// Email notification — disabled for now; re-enable when SMTP/Mailgun is configured
// const sendEmail = require('../../middleware/mail');

const CONTACT_SUCCESS_MESSAGE =
    "Thank you for getting in touch! We've received your message and one of our team members will contact you soon.";

// Create contact form submission
const createContact = async (req, res) => {
    try {
        const { message, query } = req.body;

        const messageContent = message || query;

        if (!messageContent || !messageContent.trim()) {
            return response.error400(res, 'Message or query is required');
        }

        const contact = new Contact({ message: messageContent.trim() });
        await contact.save();

        // --- SMTP / Mailgun notification (disabled for now) ---
        // try {
        //     const emailSubject = `New Enquiry Raised`;
        //     const emailMessage = `...`;
        //     const recipients = ['info@palmislandgh.com'];
        //     const emailPromises = recipients.map((email) =>
        //         sendEmail({ to: email, subject: emailSubject, message: emailMessage })
        //     );
        //     await Promise.all(emailPromises);
        // } catch (emailError) {
        //     console.error('Failed to send enquiry email:', emailError);
        // }

        return response.created201(res, CONTACT_SUCCESS_MESSAGE, {
            message: CONTACT_SUCCESS_MESSAGE,
            enquiry: contact.getFormattedContact()
        });
    } catch (error) {
        console.error('Error creating contact:', error);
        return response.serverError500(res, 'Failed to submit enquiry', error.message);
    }
};

// Get all contact messages with pagination
const getAllMessages = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const query = { isDeleted: false };

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const messages = await Contact.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10));

        const total = await Contact.countDocuments(query);

        return response.success200(res, 'Messages retrieved successfully', {
            messages: messages.map((m) => m.getFormattedContact()),
            pagination: {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                total,
                pages: Math.ceil(total / parseInt(limit, 10))
            }
        });
    } catch (error) {
        console.error('Error getting messages:', error);
        return response.serverError500(res, 'Failed to retrieve messages', error.message);
    }
};

module.exports = {
    createContact,
    getAllMessages
};
