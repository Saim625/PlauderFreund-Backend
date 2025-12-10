import express from "express";
import { v4 as uuidv4 } from "uuid";
import AdminAccessToken from "../../../models/AdminAccessToken.js";
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

      const admins = await AdminAccessToken.find().select("-__v"); // exclude __v
      return res.json({ success: true, admins });
    } catch (err) {
      console.error("Get admins error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
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

      const newAdmin = await AdminAccessToken.create({
        token,
        role,
        permissions: {
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
  }
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

      const target = await AdminAccessToken.findById(req.params.id);
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

      target.isActive = !target.isActive;
      await target.save();

      return res.json({
        success: true,
        message: "Status updated",
        admin: target,
      });
    } catch (err) {
      console.error("Toggle admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
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

      const target = await AdminAccessToken.findById(req.params.id);
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

      await AdminAccessToken.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: "Admin deleted" });
    } catch (err) {
      console.error("Delete admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
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

      const target = await AdminAccessToken.findById(req.params.id);
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

      target.token = newToken;
      await target.save();

      return res.json({
        success: true,
        message: "Token updated",
        admin: target,
      });
    } catch (err) {
      console.error("Edit admin token error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);
