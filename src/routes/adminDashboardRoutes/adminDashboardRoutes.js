// routes/adminDashboardRoutes/adminDashboardRoutes.js
import express from "express";
import { verifyAdminToken } from "../../middleware/verifyAdminToken.js";
import prisma from "../../lib/db.js";

export const adminRouter = express.Router();

// Get all user tokens (admin-only)
adminRouter.get(
  "/getTokenDetails",
  verifyAdminToken(["canManageUsers"]),
  async (req, res) => {
    try {
      const fetchAllTokens = await prisma.userAccessToken.findMany();
      res.status(200).json({ success: true, tokens: fetchAllTokens });
    } catch (err) {
      console.error("Error fetching tokens:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);
