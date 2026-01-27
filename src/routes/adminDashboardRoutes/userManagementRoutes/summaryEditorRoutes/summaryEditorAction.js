import express from "express";
import { verifyAdminToken } from "../../../../middleware/verifyAdminToken.js";
import prisma from "../../../../lib/db.js";

export const summaryEditorRouter = express.Router();

summaryEditorRouter.delete(
  "/user/summary/:token",
  verifyAdminToken("canAccessMemoryEditor"), // CRITICAL: Only admins should delete data
  async (req, res) => {
    try {
      const { token } = req.params;

      // Delete memory summary
      const deletedSummary = await prisma.memorySummary.delete({
        where: { token },
      });

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

      // Find memory summary
      const memorySummary = await prisma.memorySummary.findUnique({
        where: { token },
        include: { summary: true },
      });

      if (!memorySummary) {
        return res.status(404).json({
          success: false,
          message: "User Summary not found.",
        });
      }

      // Find and delete the item
      const itemToDelete = memorySummary.summary.find(
        (item) => item.category === category && item.key === key
      );

      if (itemToDelete) {
        await prisma.memorySummaryItem.delete({
          where: { id: itemToDelete.id },
        });
      }

      // Get updated summary
      const updated = await prisma.memorySummary.findUnique({
        where: { token },
        include: { summary: true },
      });

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

      // Find memory summary
      const memorySummary = await prisma.memorySummary.findUnique({
        where: { token },
        include: { summary: true },
      });

      if (!memorySummary) {
        return res.status(404).json({
          success: false,
          message: "User Summary not found.",
        });
      }

      // Find the item to update
      const itemToUpdate = memorySummary.summary.find(
        (item) => item.key === key && item.category === category
      );

      if (!itemToUpdate) {
        return res.status(404).json({
          success: false,
          message:
            "Memory item not found. Ensure the Key and Category are correct.",
        });
      }

      // Update the item
      await prisma.memorySummaryItem.update({
        where: { id: itemToUpdate.id },
        data: {
          value: String(value),
          lastUpdated: new Date(),
        },
      });

      // Get updated summary
      const updated = await prisma.memorySummary.findUnique({
        where: { token },
        include: { summary: true },
      });

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

      // 1. Find or create memory summary
      let memorySummary = await prisma.memorySummary.findUnique({
        where: { token },
        include: { summary: true },
      });

      if (!memorySummary) {
        memorySummary = await prisma.memorySummary.create({
          data: {
            token,
          },
          include: { summary: true },
        });
      }

      // 2. Check if the item already exists
      const existingItem = memorySummary.summary.find(
        (item) => item.key === key && item.category === category
      );

      if (existingItem) {
        // 3. If it exists, UPDATE it instead of adding a duplicate
        await prisma.memorySummaryItem.update({
          where: { id: existingItem.id },
          data: {
            value: String(value),
            lastUpdated: new Date(),
          },
        });

        const updated = await prisma.memorySummary.findUnique({
          where: { token },
          include: { summary: true },
        });

        return res.status(200).json({
          success: true,
          message: "Updated existing item",
          summary: updated.summary,
        });
      }

      // 4. If it doesn't exist, create a new one
      await prisma.memorySummaryItem.create({
        data: {
          category,
          key,
          value: String(value),
          memorySummaryId: memorySummary.id,
        },
      });

      await prisma.memorySummary.update({
        where: { id: memorySummary.id },
        data: { updatedAt: new Date() },
      });

      const updated = await prisma.memorySummary.findUnique({
        where: { token },
        include: { summary: true },
      });

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
