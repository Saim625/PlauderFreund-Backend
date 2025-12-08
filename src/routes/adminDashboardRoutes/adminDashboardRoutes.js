import express from "express";
import UserAccessToken from "../../models/UserAccessToken.js";
export const adminRouter = express.Router();

adminRouter.get("/getTokenDetails", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Token is required" });
    }

    const validToken = await UserAccessToken.findOne({ token, isActive: true });

    if (!validToken)
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token" });

    const isAdmin = validToken.isAdmin || false;

    if (!isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden for this action" });
    }

    const fetchAllToken = await UserAccessToken.find();
    res.status(200).json({ success: true, tokens: fetchAllToken });
  } catch (err) {
    console.error("Error verifying token:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
