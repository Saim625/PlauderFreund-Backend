// routes/auth.js
import express from "express";
import UserAccessToken from "../models/UserAccessToken.js";
import { verifyToken } from "../middleware/verifyToken.js";

export const authRouter = express.Router();

authRouter.get("/verify-token", verifyToken("any"), (req, res) => {
  res.json({
    success: true,
    message: "Token verified",
    isAdmin: req.user.isAdmin,
  });
});
