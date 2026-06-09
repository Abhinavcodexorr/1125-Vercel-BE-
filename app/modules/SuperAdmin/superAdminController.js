const SuperAdmin = require('./superAdminModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config/auth.config');
const response = require('../../helper/response');
const sendEmail = require('../../middleware/mail');
// Update password (SuperAdmin, SubAdmin, Manager – each can update own password)
const updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return response.error400(res, "Current password and new password are required");
        }

        if (String(newPassword).length < 8) {
            return response.error400(res, "New password must be at least 8 characters long");
        }

        const user = await SuperAdmin.findById(req.userId);
        if (!user) {
            return response.notFound404(res, "User not found");
        }

        const isPasswordValid = await user.comparePassword(currentPassword);
        if (!isPasswordValid) {
            return response.unauthorized401(res, "Current password is incorrect");
        }

        user.password = newPassword;
        user.activeToken = null;
        await user.save();

        console.log(`Password updated: ${user.email} (${user.role})`);
        return response.success200(res, "Password updated successfully. Please login again.");
    } catch (error) {
        console.error(`Error updating password: ${error.message}`);
        return response.serverError500(res, "Error updating password", error.message);
    }
};

// Admin login (SuperAdmin/SubAdmin) with JWT token generation
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return response.error400(res, "Email and password are required");
        }

        const superAdmin = await SuperAdmin.findOne({
            email: email.toLowerCase().trim(),
            isActive: true,
            isDeleted: { $ne: true }
        });

        if (!superAdmin) {
            return response.unauthorized401(res, "Invalid email or password");
        }

        if ((superAdmin.role === 'SubAdmin' || superAdmin.role === 'Manager') && superAdmin.isBlocked) {
            return response.unauthorized401(res, "Your account is blocked by superadmin.");
        }

        const isPasswordValid = await superAdmin.comparePassword(password);
        
        if (!isPasswordValid) {
            return response.unauthorized401(res, "Invalid email or password");
        }

        const token = jwt.sign(
            { 
                id: superAdmin._id, 
                email: superAdmin.email, 
                role: superAdmin.role 
            },
            config.JWTSECRET,
            { expiresIn: config.ADMIN_JWT_EXPIRES_IN }
        );

        await SuperAdmin.findByIdAndUpdate(superAdmin._id, { 
            activeToken: token,
            lastLogin: new Date()
        });

        console.log(`${superAdmin.role} login successful: ${superAdmin.email}`);
        
        return response.success200(res, "Login successful", {
            token: token,
            user: {
                id: superAdmin._id,
                email: superAdmin.email,
                role: superAdmin.role,
                lastLogin: superAdmin.lastLogin
            },
            expiresIn: config.ADMIN_JWT_EXPIRES_IN
        });

    } catch (error) {
        console.error(`Error during admin login: ${error.message}`);
        return response.serverError500(res, "Error during login", error.message);
    }
};

// Create default superadmin account if it doesn't exist
const createDefaultSuperAdmin = async () => {
    try {
        const existingSuperAdmin = await SuperAdmin.findOne({ email: '1125demo@gmail.com' });
        
        if (!existingSuperAdmin) {
            const defaultSuperAdmin = new SuperAdmin({
                email: '1125demo@gmail.com',
                password: 'qwerty',
                role: 'SuperAdmin'
            });

            await defaultSuperAdmin.save();
            console.log('Default SuperAdmin created: 1125demo@gmail.com');
        }
    } catch (error) {
        console.error('Error creating default SuperAdmin:', error.message);
    }
};

// Logout and invalidate session token
const logout = async (req, res) => {
    try {
        await SuperAdmin.findByIdAndUpdate(req.userId, { 
            activeToken: null 
        });
        
        console.log(`SuperAdmin logout: ${req.userId}`);
        return response.success200(res, "Logout successful");
    } catch (error) {
        console.error(`Error during logout: ${error.message}`);
        return response.serverError500(res, "Error during logout", error.message);
    }
};

// Get current authenticated superadmin information
const getCurrentUser = async (req, res) => {
    try {
        const superAdmin = await SuperAdmin.findById(req.userId)
            .select('email role lastLogin createdAt')
            .lean();

        if (!superAdmin) {
            return response.notFound404(res, "SuperAdmin not found");
        }

        return response.success200(res, "User information retrieved", {
            id: superAdmin._id,
            email: superAdmin.email,
            role: superAdmin.role,
            lastLogin: superAdmin.lastLogin,
            createdAt: superAdmin.createdAt
        });

    } catch (error) {
        console.error(`Error retrieving user info: ${error.message}`);
        return response.serverError500(res, "Error retrieving user information", error.message);
    }
};

const generatePassword = (length = 12) => {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const allChars = uppercase + lowercase + numbers;
    
    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    
    for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    return password.split('').sort(() => Math.random() - 0.5).join('');
};

// Forgot password - generate new password and send via email
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return response.error400(res, "Email is required");
        }

        const superAdmin = await SuperAdmin.findOne({ 
            email: email.toLowerCase().trim(),
            isActive: true 
        });

        if (!superAdmin) {
            return response.notFound404(res, "Account with this email does not exist");
        }

        const newPassword = generatePassword(12);
        console.log(`Generated new password for ${superAdmin.email}: ${newPassword}`);

        superAdmin.password = newPassword;
        superAdmin.activeToken = null;
        superAdmin.resetToken = null;
        superAdmin.resetTokenExpiry = null;
        await superAdmin.save();
        const emailSubject = 'Your New Password';
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
                    .content {
                        padding: 20px;
                    }
                    .password-display {
                        font-size: 20px;
                        font-weight: bold;
                        color: #133730;
                        letter-spacing: 2px;
                        font-family: 'Courier New', monospace;
                        padding: 15px;
                        background-color: #f8f9fa;
                        border: 2px solid #133730;
                        border-radius: 5px;
                        margin: 15px 0;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div class="content">
                    <p>Hello,</p>
                    
                    <p>You recently requested to reset your password. Here is your new password:</p>
                    
                    <div class="password-display">${newPassword}</div>
                    
                    <p>If you did not attempt to reset your password, please contact us immediately.</p>
                    
                    <p>Thank you,<br>
                    <strong>Palm Island Resort Team</strong></p>
                </div>
            </body>
            </html>
        `;

        await sendEmail({
            to: superAdmin.email,
            subject: emailSubject,
            message: emailMessage
        });

        console.log(`New password sent to: ${superAdmin.email}`);
        return response.success200(res, "New password has been sent to your email. Please check your inbox.");
    } catch (error) {
        console.error(`Error in forgot password: ${error.message}`);
        return response.serverError500(res, "Error processing password reset request", error.message);
    }
};

// Create subadmin/manager (SuperAdmin only)
const createSubAdmin = async (req, res) => {
    try {
        const { firstName, lastName, email, password, role } = req.body;
        if (!email) {
            return response.error400(res, "Email is required");
        }

        const trimmedEmail = email.toLowerCase().trim();
        const existing = await SuperAdmin.findOne({ email: trimmedEmail });

        if (existing) {
            if (existing.isDeleted === false) {
                return response.error400(res, "Email already exists");
            }
            // isDeleted true: restore the soft-deleted record instead of creating new
            const staffRole = (role === 'Manager') ? 'Manager' : 'SubAdmin';
            const generatedPassword = password || generatePassword(10);
            existing.firstName = firstName || '';
            existing.lastName = lastName || '';
            existing.password = generatedPassword;
            existing.role = staffRole;
            existing.isDeleted = false;
            existing.isBlocked = false;
            existing.activeToken = null;
            await existing.save();
            console.log(`SubAdmin restored: ${existing.email}`);
            return response.created201(res, "SubAdmin created successfully", {
                id: existing._id,
                firstName: existing.firstName,
                lastName: existing.lastName,
                email: existing.email,
                role: existing.role,
                isActive: existing.isActive,
                isBlocked: existing.isBlocked,
                generatedPassword: password ? undefined : generatedPassword
            });
        }

        const staffRole = (role === 'Manager') ? 'Manager' : 'SubAdmin';
        const generatedPassword = password || generatePassword(10);
        const subAdmin = new SuperAdmin({
            firstName: firstName || '',
            lastName: lastName || '',
            email: trimmedEmail,
            password: generatedPassword,
            role: staffRole
        });

        await subAdmin.save();
        console.log(`SubAdmin created: ${subAdmin.email}`);

        return response.created201(res, "SubAdmin created successfully", {
            id: subAdmin._id,
            firstName: subAdmin.firstName,
            lastName: subAdmin.lastName,
            email: subAdmin.email,
            role: subAdmin.role,
            isActive: subAdmin.isActive,
            isBlocked: subAdmin.isBlocked,
            generatedPassword: password ? undefined : generatedPassword
        });
    } catch (error) {
        if (error.code === 11000 || (error.message && error.message.includes('duplicate key'))) {
            return response.error400(res, "Email already exists");
        }
        console.error(`Error creating subadmin: ${error.message}`);
        return response.serverError500(res, "Error creating subadmin", error.message);
    }
};

// Get subadmin/staff by ID (SuperAdmin/SubAdmin/Manager view)
const getSubAdminById = async (req, res) => {
    try {
        const { id } = req.params;
        const subAdmin = await SuperAdmin.findOne({ _id: id, role: { $in: ['SubAdmin', 'Manager'] }, isDeleted: false })
            .select('firstName lastName email role isActive isBlocked lastLogin createdAt updatedAt')
            .lean();

        if (!subAdmin) {
            return response.notFound404(res, "SubAdmin not found");
        }

        return response.success200(res, "SubAdmin retrieved successfully", subAdmin);
    } catch (error) {
        console.error(`Error retrieving subadmin: ${error.message}`);
        return response.serverError500(res, "Error retrieving subadmin", error.message);
    }
};

// List subadmins & managers
const getSubAdmins = async (req, res) => {
    try {
        const subAdmins = await SuperAdmin.find({ role: { $in: ['SubAdmin', 'Manager'] }, isDeleted: false })
            .select('firstName lastName email role isActive isBlocked lastLogin createdAt updatedAt')
            .sort({ createdAt: -1 })
            .lean();

        return response.success200(res, "SubAdmins retrieved successfully", subAdmins);
    } catch (error) {
        console.error(`Error retrieving subadmins: ${error.message}`);
        return response.serverError500(res, "Error retrieving subadmins", error.message);
    }
};

// Update subadmin/staff profile (SuperAdmin/Manager only)
const updateSubAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, email, role, password } = req.body;

        const staff = await SuperAdmin.findOne({ _id: id, role: { $in: ['SubAdmin', 'Manager'] }, isDeleted: false });
        if (!staff) {
            return response.notFound404(res, "Staff not found");
        }

        const updates = {};
        if (firstName !== undefined) updates.firstName = firstName;
        if (lastName !== undefined) updates.lastName = lastName;
        if (role !== undefined) {
            if (!['SubAdmin', 'Manager'].includes(role)) {
                return response.error400(res, "Role must be SubAdmin or Manager");
            }
            updates.role = role;
        }
        if (email !== undefined) {
            const trimmedEmail = email.toLowerCase().trim();
            const existing = await SuperAdmin.findOne({ email: trimmedEmail, _id: { $ne: id } });
            if (existing) {
                if (existing.isDeleted === false) {
                    return response.error400(res, "Email already exists");
                }
                // isDeleted true: free the email so we can use it (update deleted record's email)
                await SuperAdmin.findByIdAndUpdate(existing._id, {
                    email: `deleted_${existing._id}_${Date.now()}@deleted.local`,
                    updatedAt: new Date()
                });
            }
            updates.email = trimmedEmail;
        }
        if (password !== undefined && password !== null && String(password).trim() !== '') {
            if (String(password).length < 8) {
                return response.error400(res, "Password must be at least 8 characters long");
            }
            updates.password = password.trim();
            updates.activeToken = null;
        }

        if (Object.keys(updates).length === 0) {
            return response.error400(res, "No valid fields to update");
        }

        Object.assign(staff, updates);
        await staff.save();

        const result = await SuperAdmin.findById(id)
            .select('firstName lastName email role isActive isBlocked lastLogin createdAt updatedAt')
            .lean();

        return response.success200(res, "SubAdmin updated successfully", result);
    } catch (error) {
        if (error.code === 11000) {
            return response.error400(res, "Email already in use by another account");
        }
        console.error(`Error updating subadmin: ${error.message}`);
        return response.serverError500(res, "Error updating subadmin", error.message);
    }
};

// Block/Unblock subadmin (SuperAdmin only)
const blockSubAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { isBlocked = true } = req.body;

        const subAdmin = await SuperAdmin.findOneAndUpdate(
            { _id: id, role: { $in: ['SubAdmin', 'Manager'] }, isDeleted: false },
            {
                isBlocked: Boolean(isBlocked),
                activeToken: null
            },
            { new: true }
        ).select('firstName lastName email role isActive isBlocked');

        if (!subAdmin) {
            return response.notFound404(res, "SubAdmin not found");
        }

        return response.success200(
            res,
            isBlocked ? "SubAdmin blocked successfully" : "SubAdmin unblocked successfully",
            subAdmin
        );
    } catch (error) {
        console.error(`Error updating subadmin block status: ${error.message}`);
        return response.serverError500(res, "Error updating subadmin block status", error.message);
    }
};

// Delete subadmin (SuperAdmin only)
const deleteSubAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const subAdmin = await SuperAdmin.findOneAndUpdate(
            { _id: id, role: { $in: ['SubAdmin', 'Manager'] }, isDeleted: false },
            { isDeleted: true, isActive: false, activeToken: null },
            { new: true }
        );

        if (!subAdmin) {
            return response.notFound404(res, "SubAdmin not found");
        }

        return response.success200(res, "SubAdmin deleted successfully");
    } catch (error) {
        console.error(`Error deleting subadmin: ${error.message}`);
        return response.serverError500(res, "Error deleting subadmin", error.message);
    }
};

module.exports = {
    login,
    logout,
    getCurrentUser,
    createDefaultSuperAdmin,
    updatePassword,
    forgotPassword,
    createSubAdmin,
    getSubAdmins,
    getSubAdminById,
    updateSubAdmin,
    blockSubAdmin,
    deleteSubAdmin
};
