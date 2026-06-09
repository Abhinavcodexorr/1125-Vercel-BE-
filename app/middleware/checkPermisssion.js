const helper = require('../helper/response');

// Simplified permission check without User model
const check = (requiredPermissions) => {
  return async (req, res, next) => {
    try {
      // Since User model is removed, allow all requests to pass
      // This middleware is now just a placeholder
      next();
    } catch (error) {
      return helper.error(res, error);
    }
  };
};

module.exports = check;
