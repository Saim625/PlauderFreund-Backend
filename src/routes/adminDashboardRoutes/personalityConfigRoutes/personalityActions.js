import express from "express";
import PersonalityConfig from "../../../models/PersonalityConfig.js";
import { verifyAdminToken } from "../../../middleware/verifyAdminToken.js";

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
      const configs = await PersonalityConfig.find(
        {},
        { userToken: 1, updatedAt: 1, _id: 0 }
      ).lean();

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
  }
);

personalityActionRouter.get(
  "/user/personality/:token",
  verifyAdminToken("canAccessPersonalisedConfig"),
  async (req, res) => {
    try {
      const { token } = req.params;

      // Use upsert logic directly in findOne to handle auto-creation atomically
      const config = await PersonalityConfig.findOneAndUpdate(
        { userToken: token },
        { $setOnInsert: { userToken: token } }, // Only set token if document is being created
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

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
  }
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

      // We sanitize the body to ensure userToken cannot be changed manually via API
      const updateData = { ...req.body };
      delete updateData.userToken;

      const updated = await PersonalityConfig.findOneAndUpdate(
        { userToken: token },
        { $set: updateData },
        { new: true, upsert: true, runValidators: true }
      );

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
  }
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

      // Delete existing custom settings
      await PersonalityConfig.findOneAndDelete({ userToken: token });

      // Create a fresh config which will use the default values defined in your Mongoose Schema
      const freshConfig = await PersonalityConfig.create({ userToken: token });

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
  }
);
