// routes/auth.js
import express from "express";
import { verifyUserToken } from "../middleware/verifyUserToken.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/db.js";
import { ADMIN_JWT_SECRET } from "../config/env.js";

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

authRouter.post(
  "/verify-admin-password",
  verifyAdminToken([]), // MUST keep token check here
  async (req, res) => {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          message: "Password is required",
        });
      }

      // Only MAIN_ADMIN can pass password step
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Password login not allowed for this role",
        });
      }

      // Fetch MAIN_ADMIN account
      const adminAccount = await prisma.adminAccountPassword.findFirst({
        where: {
          role: "MAIN_ADMIN",
          isActive: true,
        },
      });

      if (!adminAccount) {
        return res.status(500).json({
          success: false,
          message: "Admin account not found",
        });
      }

      // Compare password
      const isValid = await bcrypt.compare(password, adminAccount.passwordHash);

      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: "Invalid password",
        });
      }

      // Create admin JWT (SESSION)
      const adminJWT = jwt.sign(
        {
          role: req.admin.role,
          permissions: req.admin.permissions,
        },
        ADMIN_JWT_SECRET,
        { expiresIn: "2h" }
      );

      res.json({
        success: true,
        message: "Admin authenticated",
        token: adminJWT,
      });
    } catch (err) {
      console.error("Admin password verification error:", err);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);
