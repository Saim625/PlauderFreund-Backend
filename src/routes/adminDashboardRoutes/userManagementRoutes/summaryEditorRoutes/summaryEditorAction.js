import express from "express";
import { verifyAdminToken } from "../../../../middleware/verifyAdminToken.js";
import MemorySummary from "../../../../models/MemorySummary.js";

export const summaryEditorRouter = express.Router();

summaryEditorRouter.delete(
  "/user/summary/:token",
  verifyAdminToken("canAccessMemoryEditor"), // CRITICAL: Only admins should delete data
  async (req, res) => {
    try {
      const { token } = req.params;

      // Use findOneAndDelete to ensure we are targeting the custom 'token' field
      const deletedSummary = await MemorySummary.findOneAndDelete({ token });

      if (!deletedSummary) {
        return res.status(404).json({
          success: false,
          message: "User Summary not found or already deleted.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "User memory vault has been permanently wiped.",
      });
    } catch (err) {
      console.error("Delete Summary Error:", err);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

summaryEditorRouter.delete(
  "/user/summary/:token/item",
  verifyAdminToken("canAccessMemoryEditor"),
  async (req, res) => {
    try {
      const { token } = req.params;
      const { key, category } = req.body;

      // Validation: Ensure we know exactly what to pull
      if (!key || !category) {
        return res.status(400).json({
          success: false,
          message:
            "Category and Key are required to identify the specific memory item.",
        });
      }

      // $pull targets objects in the 'summary' array that match both the category and key
      const updated = await MemorySummary.findOneAndUpdate(
        { token },
        { $pull: { summary: { category, key } } },
        { new: true } // Return the document AFTER the item is removed
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: "User Summary not found.",
        });
      }

      res.status(200).json({
        success: true,
        message: `Successfully removed '${key}' from the '${category}' category.`,
        updated,
      });
    } catch (err) {
      console.error("Delete Single Memory Item Error:", err);
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

summaryEditorRouter.put(
  "/user/summary/:token/item",
  verifyAdminToken("canAccessMemoryEditor"),
  async (req, res) => {
    try {
      const { token } = req.params;
      const { key, category, value } = req.body;

      if (!key || !category || value === undefined) {
        return res.status(400).json({
          success: false,
          message: "Key, Category, and Value are required for update.",
        });
      }

      // The positional operator "$" identifies the correct element in the array to update.
      const updated = await MemorySummary.findOneAndUpdate(
        {
          token,
          "summary.key": key,
          "summary.category": category,
        },
        {
          $set: {
            "summary.$.value": value,
            "summary.$.lastUpdated": new Date(),
          },
        },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message:
            "Memory item not found. Ensure the Key and Category are correct.",
        });
      }

      res.status(200).json({
        success: true,
        message: "Memory item updated successfully.",
        updated,
      });
    } catch (err) {
      console.error("Update Memory Item Error:", err);
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  }
);

summaryEditorRouter.post(
  "/user/summary/:token/item",
  verifyAdminToken("canAccessMemoryEditor"),
  async (req, res) => {
    try {
      const { token } = req.params;
      const { category, key, value } = req.body;

      if (!category || !key || !value) {
        return res
          .status(400)
          .json({ success: false, message: "Missing fields" });
      }

      // 1. Check if the item already exists
      const existing = await MemorySummary.findOne({
        token,
        "summary.key": key,
        "summary.category": category,
      });

      if (existing) {
        // 2. If it exists, UPDATE it instead of adding a duplicate
        const updated = await MemorySummary.findOneAndUpdate(
          { token, "summary.key": key, "summary.category": category },
          {
            $set: {
              "summary.$.value": value,
              "summary.$.lastUpdated": new Date(),
            },
          },
          { new: true }
        );
        return res
          .status(200)
          .json({
            success: true,
            message: "Updated existing item",
            summary: updated.summary,
          });
      }

      // 3. If it doesn't exist, PUSH a new one (upsert creates the doc if missing)
      const updated = await MemorySummary.findOneAndUpdate(
        { token },
        {
          $push: { summary: { category, key, value, lastUpdated: new Date() } },
          $set: { updatedAt: new Date() },
        },
        { new: true, upsert: true } // upsert: true handles the "create if not exists" logic
      );

      return res
        .status(201)
        .json({
          success: true,
          message: "Memory added",
          summary: updated.summary,
        });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);
