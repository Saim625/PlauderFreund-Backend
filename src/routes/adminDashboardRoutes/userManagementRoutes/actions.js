// routes/adminDashboardRoutes/userManagementRoutes/actions.js
import express from "express";
import prisma from "../../../lib/db.js";
import { verifyAdminToken } from "../../../middleware/verifyAdminToken.js";
import { v4 as uuidv4 } from "uuid";
import { ELEVENLABS_VOICE_ID } from "../../../config/env.js";

export const actionRouter = express.Router();

// Toggle user token status
actionRouter.put(
  "/token/:id/toggle-status",
  verifyAdminToken(["canManageUsers"]),
  async (req, res) => {
    try {
      const userTokenId = parseInt(req.params.id);
      console.log(userTokenId);
      const userRecord = await prisma.userAccessToken.findUnique({
        where: { id: userTokenId },
      });

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

      const updated = await prisma.userAccessToken.update({
        where: { id: userTokenId },
        data: { isActive: !userRecord.isActive },
      });

      userRecord.isActive = updated.isActive;

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
  },
);

// Delete user token
actionRouter.delete(
  "/token/:id",
  verifyAdminToken(["canDeleteTokens"]),
  async (req, res) => {
    try {
      const tokenId = parseInt(req.params.id);
      const userRecord = await prisma.userAccessToken.findUnique({
        where: { id: tokenId },
      });

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

      // Note: isAdmin field doesn't exist in UserAccessToken model
      // If needed, this check can be removed or handled differently

      // Delete related data
      await prisma.$transaction([
        prisma.memorySummary.deleteMany({ where: { token: userRecord.token } }),
        prisma.personalityConfig.deleteMany({
          where: { userToken: userRecord.token },
        }),
        prisma.conversation.deleteMany({ where: { token: userRecord.token } }),
        prisma.reminder.deleteMany({ where: { userToken: userRecord.token } }),
        prisma.reminderDeliveryLog.deleteMany({
          where: { userToken: userRecord.token },
        }),
        prisma.greetingHistory.deleteMany({
          where: { userToken: userRecord.token },
        }),
        prisma.sessionLog.deleteMany({
          where: { userToken: userRecord.token },
        }),
        prisma.userUsageSummary.deleteMany({
          where: { userToken: userRecord.token },
        }),
        prisma.userAccessToken.delete({ where: { id: tokenId } }),
      ]);

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
  },
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

      const record = await prisma.userAccessToken.create({
        data: {
          token,
          isActive: true,
        },
      });

      await prisma.personalityConfig.create({
        data: {
          userToken: token,
          voiceId: ELEVENLABS_VOICE_ID || undefined,
        },
      });

      return res.json({
        success: true,
        message: "User invitation token generated",
        token,
        inviteUrl: `https://plauderfreund.de/?token=${token}`,
        id: record.id,
      });
    } catch (err) {
      console.error("Generate token error:", err);
      res.status(500).json({
        success: false,
        message: "Server error while generating token",
      });
    }
  },
);

actionRouter.get(
  "/user/summary/:token",
  verifyAdminToken("canAccessMemoryEditor"),
  async (req, res) => {
    try {
      const userToken = req.params.token;

      const userSummary = await prisma.memorySummary.findUnique({
        where: { token: userToken },
        include: { summary: true },
      });

      if (!userSummary) {
        return res.status(404).json({
          success: false,
          message: "User Summary Not Found",
        });
      }

      // Return the data
      return res.status(200).json({
        success: true,
        token: userSummary.token,
        summary: userSummary.summary,
      });
    } catch (err) {
      // FIX 3: Log the error for the developer
      console.error("Fetch Summary Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  },
);
