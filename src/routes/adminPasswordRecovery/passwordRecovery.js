import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import { EMAIL_PASS, FRONTEND_URL, USER_NAME } from "../../config/env.js";
import AdminAccountPassword from "../../models/AdminAccountPassword.js";

export const adminPasswordRouter = express.Router();

/**
 * Send forgot password email
 */
adminPasswordRouter.post("/admin/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const admin = await AdminAccountPassword.findOne({
      email,
      role: "MAIN_ADMIN",
      isActive: true,
    });

    if (!admin) {
      return res.json({ success: false, message: "Email not correct" }); // don't reveal existence
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    admin.resetPasswordToken = hashedToken;
    admin.resetPasswordTokenExpiresAt = Date.now() + 15 * 60 * 1000; // 15 min

    await admin.save();

    const resetLink = `${FRONTEND_URL}/admin/reset-password?token=${resetToken}`;

    // Setup Nodemailer transporter (Gmail example)
    const transporter = nodemailer.createTransport({
      host: "smtp.strato.de",
      port: 587,
      secure: false,
      auth: {
        user: USER_NAME,
        pass: EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"PlauderFreund" <${USER_NAME}>`,
      to: email,
      subject: "Reset your admin password",
      html: `<p>Click the link below to reset your password:</p>
             <a href="${resetLink}">${resetLink}</a>
             <p>This link will expire in 15 minutes.</p>`,
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: "Reset link sent to email" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * Reset password
 */
adminPasswordRouter.post("/admin/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Token and new password required",
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const admin = await AdminAccountPassword.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordTokenExpiresAt: { $gt: Date.now() },
      role: "MAIN_ADMIN",
      isActive: true,
    });

    if (!admin) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    admin.resetPasswordToken = undefined;
    admin.resetPasswordTokenExpiresAt = undefined;

    await admin.save();

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
