// routes/auth.js
import express from "express";
import UserAccessToken from "../models/UserAccessToken.js";
import AdminAccessToken from "../models/AdminAccessToken.js";
import { verifyUserToken } from "../middleware/verifyUserToken.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";

export const authRouter = express.Router();

/**
 * Verify a user token
 * Public or protected routes for normal users
 */
authRouter.get("/verify-user-token", verifyUserToken(), (req, res) => {
  res.json({
    success: true,
    message: "User token verified",
  });
});

/**
 * Verify an admin token
 * Only for admins
 */
authRouter.get(
  "/verify-admin-token",
  verifyAdminToken([]), // empty array → no specific permission required
  (req, res) => {
    res.json({
      success: true,
      message: "Admin token verified",
      role: req.admin.role,
      permissions: req.admin.permissions,
    });
  }
);
