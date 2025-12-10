// routes/adminDashboardRoutes/userManagementRoutes/actions.js
import express from "express";
import UserAccessToken from "../../../models/UserAccessToken.js";
import { verifyAdminToken } from "../../../middleware/verifyAdminToken.js";
import { v4 as uuidv4 } from "uuid";

export const actionRouter = express.Router();

// Toggle user token status
actionRouter.put(
  "/token/:id/toggle-status",
  verifyAdminToken(["canManageUsers"]),
  async (req, res) => {
    try {
      const userTokenId = req.params.id;
      const userRecord = await UserAccessToken.findById(userTokenId);

      if (!userRecord) {
        return res.status(404).json({
          success: false,
          message: "User token not found",
        });
      }

      // Prevent admin from modifying their own token
      if (userRecord.token === req.admin.token) {
        return res.status(400).json({
          success: false,
          message: "Admin cannot modify their own token",
        });
      }

      userRecord.isActive = !userRecord.isActive;
      await userRecord.save();

      return res.json({
        success: true,
        message: `Token status changed to ${
          userRecord.isActive ? "ACTIVE" : "INACTIVE"
        }`,
        data: userRecord,
      });
    } catch (err) {
      console.error("Toggle error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

// Delete user token
actionRouter.delete(
  "/token/:id",
  verifyAdminToken(["canDeleteTokens"]),
  async (req, res) => {
    try {
      const tokenId = req.params.id;
      const userRecord = await UserAccessToken.findById(tokenId);

      if (!userRecord) {
        return res.status(404).json({
          success: false,
          message: "User token not found",
        });
      }

      if (userRecord.token === req.admin.token) {
        return res.status(400).json({
          success: false,
          message: "You cannot delete your own token",
        });
      }

      if (userRecord.isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Admin tokens cannot be deleted",
        });
      }

      await UserAccessToken.findByIdAndDelete(tokenId);

      return res.json({
        success: true,
        message: "Token deleted successfully",
        deletedId: tokenId,
      });
    } catch (err) {
      console.error("Delete error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

// Generate 6-7 char alphanumeric token
function generateAlphaNumericToken(length = 7) {
  return uuidv4().replace(/-/g, "").slice(0, length);
}

// Generate new user token
actionRouter.post(
  "/token/generate",
  verifyAdminToken(["canCreateTokens"]),
  async (req, res) => {
    try {
      const token = generateAlphaNumericToken(7);

      const record = await UserAccessToken.create({
        token,
        isAdmin: false,
        isActive: true,
      });

      return res.json({
        success: true,
        message: "User invitation token generated",
        token,
        inviteUrl: `https://plauderfreund.de/?token=${token}`,
        id: record._id,
      });
    } catch (err) {
      console.error("Generate token error:", err);
      res.status(500).json({
        success: false,
        message: "Server error while generating token",
      });
    }
  }
);
