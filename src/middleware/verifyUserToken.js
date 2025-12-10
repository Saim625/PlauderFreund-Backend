import UserAccessToken from "../models/UserAccessToken.js";

export function verifyUserToken() {
  return async (req, res, next) => {
    try {
      let token = extractToken(req);

      if (!token) {
        return res
          .status(401)
          .json({ success: false, message: "Token missing" });
      }

      const userRecord = await UserAccessToken.findOne({
        token,
        isActive: true,
      });

      if (!userRecord) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token",
        });
      }

      req.user = userRecord;
      next();
    } catch (err) {
      console.error("User token verify error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  };
}

function extractToken(req) {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.split(" ")[1];
  if (req.query.token) return req.query.token;
  if (req.body?.token) return req.body.token;
  return null;
}
