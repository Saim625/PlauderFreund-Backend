import AdminAccessToken from "../models/AdminAccessToken.js";

/**
 * Middleware to verify Admin token and check permissions.
 * @param {Array<string>} requiredPermissions - List of permissions required for this route.
 */
export function verifyAdminToken(requiredPermissions = []) {
  return async (req, res, next) => {
    try {
      const token = extractToken(req);

      if (!token) {
        return res.status(401).json({
          success: false,
          message: "Token missing",
        });
      }

      // Find the admin token in DB
      const adminRecord = await AdminAccessToken.findOne({
        token,
        isActive: true,
      });

      if (!adminRecord) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired admin token",
        });
      }

      // MAIN_ADMIN bypasses permission checks
      if (adminRecord.role !== "MAIN_ADMIN") {
        for (const perm of requiredPermissions) {
          if (!adminRecord.permissions[perm]) {
            return res.status(403).json({
              success: false,
              message: `Permission denied: ${perm}`,
            });
          }
        }
      }

      // Attach admin info to request
      req.admin = adminRecord;

      next();
    } catch (err) {
      console.error("Admin token verification error:", err);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  };
}

/**
 * Extract token from header, query, or body
 */
function extractToken(req) {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.split(" ")[1];
  if (req.query.token) return req.query.token;
  if (req.body?.token) return req.body.token;
  return null;
}
