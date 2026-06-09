const jwt = require("jsonwebtoken");
const config = require("../config/auth.config");
const SuperAdmin = require("../modules/SuperAdmin/superAdminModel");

const isSuper = async (req, res, next) => {
 
  let token = req.headers["x-access-token"];
  // Also support Authorization: Bearer <token>
  if (!token && req.headers.authorization) {
    const [scheme, value] = req.headers.authorization.split(' ');
    if (scheme === 'Bearer' && value) token = value.trim();
  }

  if (!token) {
    return res.status(403).send({
      message: "No token provided!",
    });
  }

  jwt.verify(token, config.JWTSECRET, async (err, decoded) => {
   
    if (err) {
      return res.status(401).send({
        message: "Unauthorized or Token expired!",
      });
    }

    // Check if the role is superadmin
    if (decoded.role !== "SuperAdmin") {
      return res.status(403).send({
        message: "Access denied! You must be a superadmin.",
      });
    }

    // Logged-out and password-reset paths clear activeToken; JWT validity is the main TTL (see ADMIN_JWT_EXPIRES_IN).
    try {
      const superAdmin = await SuperAdmin.findById(decoded.id);
      
      if (!superAdmin || !superAdmin.activeToken) {
        return res.status(401).send({
          message: "Please login again.",
        });
      }
    } catch (error) {
      return res.status(401).send({
        message: "Session validation failed.",
      });
    }

    // Proceed if user is superadmin and token is active
    req.userId = decoded.id;
    req.role = decoded.role;
    next();
  });
};



const isSuperSub = async (req, res, next) => {

  let token = req.headers["x-access-token"];
  if (!token && req.headers.authorization) {
    const [scheme, value] = req.headers.authorization.split(' ');
    if (scheme === 'Bearer' && value) token = value.trim();
  }

  if (!token) {
    return res.status(403).send({
      message: "No token provided!",
    });
  }


  jwt.verify(token, config.JWTSECRET, async (err, decoded) => {
    if (err) {
      console.log("errr....", err);

      return res.status(401).send({
        message: "Unauthorized or Token expired!",
      });
    }

    // Check if the role is superadmin, subadmin, or manager
    if (decoded.role !== "SubAdmin" && decoded.role !== "SuperAdmin" && decoded.role !== "Manager") {
      return res.status(403).send({
        message: "Access denied! You must be an admin, subadmin, or manager.",
      });
    }

    try {
      const user = await SuperAdmin.findById(decoded.id);
      if (!user || user.isDeleted || !user.isActive) {
        return res.status(401).send({
          message: "Session expired. Please login again.",
        });
      }
      if (decoded.role !== user.role) {
        return res.status(401).send({
          message: "Session expired. Please login again.",
        });
      }
      if ((user.role === "SubAdmin" || user.role === "Manager") && user.isBlocked) {
        return res.status(401).send({
          message: "Your account is blocked by superadmin.",
        });
      }
      if (!user.activeToken) {
        return res.status(401).send({
          message: "Please login again.",
        });
      }

      // Proceed if session is valid
      req.userId = decoded.id;
      req.role = decoded.role;
      next();
    } catch (error) {
      return res.status(401).send({
        message: "Session validation failed.",
      });
    }
  });
};


module.exports = { isSuper, isSuperSub };
