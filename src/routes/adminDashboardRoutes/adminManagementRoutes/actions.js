import express from "express";
import { v4 as uuidv4 } from "uuid";
import prisma from "../../../lib/db.js";
import { verifyAdminToken } from "../../../middleware/verifyAdminToken.js";

export const adminActionRouter = express.Router();

/**
 * Get all admins
 * Only accessible by MAIN_ADMIN (we enforce below)
 */
adminActionRouter.get(
  "/admins",
  verifyAdminToken(), // anyone with admin token can hit, we'll block non-MAIN_ADMIN below
  async (req, res) => {
    try {
      // Only MAIN_ADMIN can fetch the full admin list
      if (req.admin.role !== "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Only Main Admin allowed" });
      }

      const admins = await prisma.adminAccessToken.findMany();
      return res.json({ success: true, admins });
    } catch (err) {
      console.error("Get admins error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

adminActionRouter.post(
  "/admins",
  verifyAdminToken(), // must be admin; check role inside
  async (req, res) => {
    try {
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can create admins",
        });
      }

      // Read desired role/permissions from body (optional). By default new admin = ADMIN
      const { role = "ADMIN", permissions = {} } = req.body;

      // generate token (alphanumeric)
      const token = uuidv4().replace(/-/g, "").slice(0, 7);

      const newAdmin = await prisma.adminAccessToken.create({
        data: {
          token,
          role,
          canManageUsers: !!permissions.canManageUsers,
          canCreateTokens: !!permissions.canCreateTokens,
          canDeleteTokens: !!permissions.canDeleteTokens,
          canEditAdmin: !!permissions.canEditAdmin,
          canAccessMemoryEditor: !!permissions.canAccessMemoryEditor,
          canAccessPersonalisedConfig:
            !!permissions.canAccessPersonalisedConfig,
        },
      });

      return res.json({
        success: true,
        message: "Admin created",
        admin: newAdmin,
        inviteUrl: `https://plauderfreund.de/admin?token=${token}`,
      });
    } catch (err) {
      console.error("Create admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

adminActionRouter.put(
  "/admins/:id/toggle-status",
  verifyAdminToken(),
  async (req, res) => {
    try {
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can toggle admins",
        });
      }

      const target = await prisma.adminAccessToken.findUnique({
        where: { id: parseInt(req.params.id) },
      });

      if (!target)
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });

      // Prevent toggling main admin by others (and prevent main admin toggling themself accidentally)
      if (target.role === "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Main Admin cannot be toggled" });
      }

      const updated = await prisma.adminAccessToken.update({
        where: { id: target.id },
        data: { isActive: !target.isActive },
      });

      target.isActive = updated.isActive;

      return res.json({
        success: true,
        message: "Status updated",
        admin: target,
      });
    } catch (err) {
      console.error("Toggle admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

/**
 * Delete admin (cannot delete MAIN_ADMIN or self)
 */
adminActionRouter.delete(
  "/admins/:id",
  verifyAdminToken(),
  async (req, res) => {
    try {
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can delete admins",
        });
      }

      const target = await prisma.adminAccessToken.findUnique({
        where: { id: parseInt(req.params.id) },
      });

      if (!target)
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });

      if (target.role === "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Main Admin cannot be deleted" });
      }

      if (target.token === req.admin.token) {
        return res.status(400).json({
          success: false,
          message: "You cannot delete your own admin token",
        });
      }

      await prisma.adminAccessToken.delete({
        where: { id: target.id },
      });
      return res.json({ success: true, message: "Admin deleted" });
    } catch (err) {
      console.error("Delete admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

/**
 * Edit own token (admin can update their own token string)
 * Everyone can update their own token; MAIN_ADMIN protection handled elsewhere
 */
adminActionRouter.put(
  "/admins/:id/edit-token",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { newToken } = req.body;
      if (!newToken)
        return res
          .status(400)
          .json({ success: false, message: "newToken is required" });

      const target = await prisma.adminAccessToken.findUnique({
        where: { id: parseInt(req.params.id) },
      });

      if (!target)
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });

      // 1️⃣ Block editing MAIN_ADMIN token unless user is MAIN_ADMIN
      if (target.role === "MAIN_ADMIN" && req.admin.role !== "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Cannot edit Main Admin token" });
      }

      // 2️⃣ Allow editing if the user is the admin themselves or MAIN_ADMIN
      if (target.token !== req.admin.token && req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Not allowed to edit this admin token",
        });
      }

      const updated = await prisma.adminAccessToken.update({
        where: { id: target.id },
        data: { token: newToken },
      });

      target.token = updated.token;

      return res.json({
        success: true,
        message: "Token updated",
        admin: target,
      });
    } catch (err) {
      console.error("Edit admin token error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// Assign number to user token (MAIN_ADMIN only)
adminActionRouter.post(
  "/token/:id/assign-number",
  verifyAdminToken(), // Must be admin
  async (req, res) => {
    try {
      // Only MAIN_ADMIN can assign numbers
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can assign numbers",
        });
      }

      const userTokenId = parseInt(req.params.id);
      if (isNaN(userTokenId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid token ID",
        });
      }

      const { number } = req.body;

      // Validation: Check if number is provided
      if (!number) {
        return res.status(400).json({
          success: false,
          message: "Number is required",
        });
      }

      // Validation: Check if number is 11 or 12 digits
      const numberStr = String(number).trim();
      if (!/^[^<>]{0,15}$/.test(numberStr)) {
        return res.status(400).json({
          success: false,
          message: "Number must be between 10 to 15 digits",
        });
      }

      // Check if token exists
      const userRecord = await prisma.userAccessToken.findUnique({
        where: { id: userTokenId },
      });

      if (!userRecord) {
        return res.status(404).json({
          success: false,
          message: "User token not found",
        });
      }

      // Check if number is already assigned to another token
      const existingNumber = await prisma.userAccessToken.findFirst({
        where: {
          number: numberStr,
          id: { not: userTokenId }, // Exclude current token
        },
      });

      if (existingNumber) {
        return res.status(400).json({
          success: false,
          message: "This number is already assigned to another token",
        });
      }

      // Assign the number
      const updated = await prisma.userAccessToken.update({
        where: { id: userTokenId },
        data: { number: numberStr },
      });

      return res.json({
        success: true,
        message: "Number assigned successfully",
        data: {
          id: updated.id,
          token: updated.token,
          number: updated.number,
        },
      });
    } catch (err) {
      console.error("Assign number error:", err);

      // Handle unique constraint violation
      if (err.code === "P2002") {
        return res.status(400).json({
          success: false,
          message: "This number is already assigned to another token",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Server error",
        err,
      });
    }
  },
);

// Update assigned number (MAIN_ADMIN only)
adminActionRouter.put(
  "/token/:id/update-number",
  verifyAdminToken(), // Must be admin
  async (req, res) => {
    try {
      // Only MAIN_ADMIN can update numbers
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can update numbers",
        });
      }

      const userTokenId = parseInt(req.params.id);
      if (isNaN(userTokenId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid token ID",
        });
      }

      const { number } = req.body;

      // Validation: Check if number is provided
      if (!number) {
        return res.status(400).json({
          success: false,
          message: "Number is required",
        });
      }

      // Validation: Check if number is 11 or 12 digits
      const numberStr = String(number).trim();
      if (!/^[^<>]{0,15}$/.test(numberStr)) {
        return res.status(400).json({
          success: false,
          message: "Number must be 0 to 15 digits",
        });
      }

      // Check if token exists
      const userRecord = await prisma.userAccessToken.findUnique({
        where: { id: userTokenId },
      });

      if (!userRecord) {
        return res.status(404).json({
          success: false,
          message: "User token not found",
        });
      }

      // Check if number is already assigned to another token
      const existingNumber = await prisma.userAccessToken.findFirst({
        where: {
          number: numberStr,
          id: { not: userTokenId }, // Exclude current token
        },
      });

      if (existingNumber) {
        return res.status(400).json({
          success: false,
          message: "This number is already assigned to another token",
        });
      }

      // Update the number
      const updated = await prisma.userAccessToken.update({
        where: { id: userTokenId },
        data: { number: numberStr },
      });

      return res.json({
        success: true,
        message: "Number updated successfully",
        data: {
          id: updated.id,
          token: updated.token,
          number: updated.number,
        },
      });
    } catch (err) {
      console.error("Update number error:", err);

      // Handle unique constraint violation
      if (err.code === "P2002") {
        return res.status(400).json({
          success: false,
          message: "This number is already assigned to another token",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);
