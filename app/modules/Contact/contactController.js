const Contact = require('./contactModel');
const response = require('../../helper/response');
const sendEmail = require('../../middleware/mail');
const {
    ENQUIRY_EMAIL_SUBJECT,
    buildEnquiryEmailHtml,
    getInquiryRecipient
} = require('./enquiryEmailTemplate');

const CONTACT_SUCCESS_MESSAGE =
    "Thank you for getting in touch! We've received your message and one of our team members will contact you soon.";

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

const createContact = async (req, res) => {
    try {
        const { name, email, message, note, query } = req.body;

        const trimmedName = String(name || '').trim();
        const trimmedEmail = String(email || '').trim().toLowerCase();
        const messageContent = String(message || note || query || '').trim();

        if (!trimmedName) {
            return response.error400(res, 'Name is required');
        }
        if (!trimmedEmail) {
            return response.error400(res, 'Email is required');
        }
        if (!EMAIL_REGEX.test(trimmedEmail)) {
            return response.error400(res, 'Please enter a valid email address');
        }
        if (!messageContent) {
            return response.error400(res, 'Message is required');
        }

        const contact = new Contact({
            name: trimmedName,
            email: trimmedEmail,
            message: messageContent
        });
        await contact.save();

        try {
            await sendEmail({
                to: getInquiryRecipient(),
                subject: ENQUIRY_EMAIL_SUBJECT,
                message: buildEnquiryEmailHtml({
                    name: trimmedName,
                    email: trimmedEmail,
                    message: messageContent,
                    submittedAt: contact.createdAt
                }),
                fromName: '1125 Beach Villa'
            });
        } catch (emailError) {
            console.error('Failed to send enquiry email:', emailError);
        }

        return response.created201(res, CONTACT_SUCCESS_MESSAGE, {
            message: CONTACT_SUCCESS_MESSAGE,
            enquiry: contact.getFormattedContact()
        });
    } catch (error) {
        console.error('Error creating contact:', error);
        return response.serverError500(res, 'Failed to submit enquiry', error.message);
    }
};

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
