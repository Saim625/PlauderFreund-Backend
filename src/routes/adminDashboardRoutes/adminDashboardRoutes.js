// routes/adminDashboardRoutes/adminDashboardRoutes.js
import express from "express";
import { verifyAdminToken } from "../../middleware/verifyAdminToken.js";
import UserAccessToken from "../../models/UserAccessToken.js";

export const adminRouter = express.Router();

// Get all user tokens (admin-only)
adminRouter.get(
  "/getTokenDetails",
  verifyAdminToken(["canManageUsers"]),
  async (req, res) => {
    try {
      const fetchAllTokens = await UserAccessToken.find(); // or UserAccessToken if needed
      res.status(200).json({ success: true, tokens: fetchAllTokens });
    } catch (err) {
      console.error("Error fetching tokens:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);
