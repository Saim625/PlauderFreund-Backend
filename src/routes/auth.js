// routes/auth.js
import express from "express";
import UserAccessToken from "../models/UserAccessToken.js";

export const authRouter = express.Router();

authRouter.get("/verify-token", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "Token required" });

    const validToken = await UserAccessToken.findOne({ token, isActive: true });

    if (!validToken)
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });

    res.json({ success: true, message: "Token verified" });
  } catch (err) {
    console.error("Error verifying token:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
