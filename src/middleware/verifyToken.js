import UserAccessToken from "../models/UserAccessToken.js";

export function verifyToken(requiredRole = "any") {
  return async (req, res, next) => {
    try {
      let token = null;

      // 1. Check Authorization header
      const authHeader = req.headers["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }

      // 2. If not found, check query token
      else if (req.query.token) {
        token = req.query.token;
      }

      // 3. If not found, check body token (optional)
      else if (req.body && req.body.token) {
        token = req.body.token;
      }

      // If still not found → reject
      if (!token) {
        return res.status(401).json({
          success: false,
          message: "Token missing",
        });
      }

      // Validate token in DB
      const tokenRecord = await UserAccessToken.findOne({
        token,
        isActive: true,
      });

      if (!tokenRecord) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token",
        });
      }

      // ROLE CHECKS
      if (requiredRole === "admin" && !tokenRecord.isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Admin access required",
        });
      }

      if (requiredRole === "user" && tokenRecord.isAdmin) {
        return res.status(403).json({
          success: false,
          message: "User-only access",
        });
      }

      // Attach user object to request
      req.user = tokenRecord;

      next();
    } catch (err) {
      console.error("Token verification error:", err);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  };
}
