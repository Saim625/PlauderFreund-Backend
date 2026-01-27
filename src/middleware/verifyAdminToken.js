import prisma from "../lib/db.js";

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
      const adminRecord = await prisma.adminAccessToken.findFirst({
        where: {
          token,
          isActive: true,
        },
      });

      if (!adminRecord) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired admin token",
        });
      }

      // MAIN_ADMIN bypasses permission checks
      if (adminRecord.role !== "MAIN_ADMIN") {
        // Handle both string and array permissions
        const permissions = Array.isArray(requiredPermissions)
          ? requiredPermissions
          : requiredPermissions
          ? [requiredPermissions]
          : [];

        for (const perm of permissions) {
          // Map permission string to Prisma field name (camelCase)
          const permissionMap = {
            canManageUsers: "canManageUsers",
            canCreateTokens: "canCreateTokens",
            canDeleteTokens: "canDeleteTokens",
            canEditAdmin: "canEditAdmin",
            canAccessMemoryEditor: "canAccessMemoryEditor",
            canAccessPersonalisedConfig: "canAccessPersonalisedConfig",
          };

          const permissionField = permissionMap[perm] || perm;
          if (!adminRecord[permissionField]) {
            return res.status(403).json({
              success: false,
              message: `Permission denied: ${perm}`,
            });
          }
        }
      }

      // Attach admin info to request (with permissions object for compatibility)
      req.admin = {
        ...adminRecord,
        permissions: {
          canManageUsers: adminRecord.canManageUsers,
          canCreateTokens: adminRecord.canCreateTokens,
          canDeleteTokens: adminRecord.canDeleteTokens,
          canEditAdmin: adminRecord.canEditAdmin,
          canAccessMemoryEditor: adminRecord.canAccessMemoryEditor,
          canAccessPersonalisedConfig: adminRecord.canAccessPersonalisedConfig,
        },
      };

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
