import express from "express";
import prisma from "../../../lib/db.js";
import { verifyAdminToken } from "../../../middleware/verifyAdminToken.js";
import { ELEVENLABS_VOICE_ID } from "../../../config/env.js";

export const personalityActionRouter = express.Router();

/**
 * GET PERSONALITY CONFIG
 * Fetches the user's personality settings.
 * Automatically creates a default config if one doesn't exist.
 */

personalityActionRouter.get(
  "/user/personality/tokens",
  verifyAdminToken("canAccessPersonalisedConfig"),
  async (req, res) => {
    try {
      const configs = await prisma.personalityConfig.findMany({
        select: {
          userToken: true,
          updatedAt: true,
        },
      });

      // 2. Format for Frontend (Optional but recommended)
      const formattedData = configs.map((config) => ({
        token: config.userToken,
        lastModified: config.updatedAt,
      }));

      return res.json({
        success: true,
        count: formattedData.length,
        tokens: formattedData,
      });
    } catch (error) {
      console.error("❌ Error fetching personality tokens:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch personality tokens",
      });
    }
  },
);

personalityActionRouter.get(
  "/user/personality/:token",
  verifyAdminToken("canAccessPersonalisedConfig"),
  async (req, res) => {
    try {
      const { token } = req.params;

      const userToken = await prisma.userAccessToken.findFirst({
        where: {
          token: token,
          isActive: true, // Optional: also check if active
        },
      });
      if (!userToken) {
        throw new Error("Unauthorized: Invalid or inactive token");
      }

      // Find or create config
      let config = await prisma.personalityConfig.findUnique({
        where: { userToken: token },
      });

      if (!config) {
        config = await prisma.personalityConfig.create({
          data: {
            userToken: token,
            voiceId: ELEVENLABS_VOICE_ID || undefined,
          },
        });
      }

      return res.status(200).json({
        success: true,
        personality: config,
      });
    } catch (err) {
      console.error("Get Personality Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  },
);

/**
 * UPDATE PERSONALITY CONFIG
 * Updates specific fields in the personality config using $set.
 */
personalityActionRouter.put(
  "/update/user/personality/:token",
  verifyAdminToken("canAccessPersonalisedConfig"),
  async (req, res) => {
    try {
      const { token } = req.params;

      const userToken = await prisma.userAccessToken.findFirst({
        where: {
          token: token,
          isActive: true, // Optional: also check if active
        },
      });
      if (!userToken) {
        throw new Error("Unauthorized: Invalid or inactive token");
      }

      // We sanitize the body to ensure userToken cannot be changed manually via API
      const updateData = { ...req.body };
      delete updateData.userToken;
      delete updateData.id; // Remove id if present

      // Find or create config
      let config = await prisma.personalityConfig.findUnique({
        where: { userToken: token },
      });

      if (!config) {
        config = await prisma.personalityConfig.create({
          data: {
            userToken: token,
            // ✅ Use voiceId from updateData if provided, otherwise use default
            voiceId: updateData.voiceId || ELEVENLABS_VOICE_ID || undefined,
            ...updateData,
          },
        });
      } else {
        config = await prisma.personalityConfig.update({
          where: { userToken: token },
          data: updateData,
        });
      }

      const updated = config;

      return res.status(200).json({
        success: true,
        message: "Personality configuration updated successfully",
        updated,
      });
    } catch (err) {
      console.error("Update Personality Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Failed to update configuration" });
    }
  },
);

/**
 * RESET PERSONALITY TO DEFAULT
 * Deletes the custom config and creates a fresh one using schema defaults.
 */
personalityActionRouter.post(
  "/user/personality/:token/reset",
  verifyAdminToken("canAccessPersonalisedConfig"),
  async (req, res) => {
    try {
      const { token } = req.params;

      const userToken = await prisma.userAccessToken.findFirst({
        where: {
          token: token,
          isActive: true, // Optional: also check if active
        },
      });
      if (!userToken) {
        throw new Error("Unauthorized: Invalid or inactive token");
      }

      // Delete existing custom settings
      await prisma.personalityConfig
        .delete({
          where: { userToken: token },
        })
        .catch(() => {
          // Ignore if doesn't exist
        });

      // Create a fresh config which will use the default values defined in Prisma schema
      const freshConfig = await prisma.personalityConfig.create({
        data: {
          userToken: token,
          voiceId: ELEVENLABS_VOICE_ID || undefined,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Personality has been reset to system defaults",
        personality: freshConfig,
      });
    } catch (err) {
      console.error("Reset Personality Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Reset operation failed" });
    }
  },
);
