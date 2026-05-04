// routes/avatarRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import prisma from "../lib/db.js";
import { verifyAdminToken } from "../middleware/verifyAdminToken.js";

export const avatarRouter = express.Router();

// ── Storage config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), "uploads", "avatars");
    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Name file by userToken — overwrites old avatar automatically
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.params.userToken}${ext}`);
  },
});

// ── File validation ───────────────────────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only jpg, png and webp images are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
});

// ── POST /api/user/avatar/:userToken ──────────────────────────────────────────
avatarRouter.post(
  "/user/avatar/:userToken",
  verifyAdminToken(),
  upload.single("avatar"), // "avatar" is the form field name
  async (req, res) => {
    try {
      const { userToken } = req.params;

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }

      // Build the public URL — served via /uploads static middleware
      const ext = path.extname(req.file.originalname).toLowerCase();
      const avatarUrl = `/uploads/avatars/${userToken}${ext}`;

      // Delete old avatar if extension changed (e.g. old was .png, new is .jpg)
      const extensions = [".jpg", ".jpeg", ".png", ".webp"];
      for (const oldExt of extensions) {
        if (oldExt === ext) continue;
        const oldPath = path.join(
          process.cwd(),
          "uploads",
          "avatars",
          `${userToken}${oldExt}`,
        );
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      // Update PersonalityConfig
      await prisma.personalityConfig.update({
        where: { userToken },
        data: { avatarUrl },
      });

      res.json({ success: true, avatarUrl });
    } catch (err) {
      console.error("Avatar upload error:", err);
      res
        .status(500)
        .json({ success: false, message: err.message || "Upload failed" });
    }
  },
);

avatarRouter.get("/user/avatar/:token", async (req, res) => {
  try {
    const { token } = req.params;

    // 1. Validate token exists
    const userToken = await prisma.userAccessToken.findFirst({
      where: {
        token: token,
        isActive: true,
      },
    });

    if (!userToken) {
      return res.status(401).json({
        success: false,
        message: "Invalid or inactive token",
      });
    }

    // 2. Get only avatarUrl
    const config = await prisma.personalityConfig.findUnique({
      where: { userToken: token },
      select: {
        avatarUrl: true, // 🔥 only fetch this
      },
    });

    return res.status(200).json({
      success: true,
      avatarUrl: config?.avatarUrl || null,
    });
  } catch (err) {
    console.error("Get Avatar Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
});

// ── DELETE /api/user/avatar/:userToken ────────────────────────────────────────
avatarRouter.delete(
  "/user/avatar/:userToken",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { userToken } = req.params;

      // Find and delete file from disk
      const extensions = [".jpg", ".jpeg", ".png", ".webp"];
      for (const ext of extensions) {
        const filePath = path.join(
          process.cwd(),
          "uploads",
          "avatars",
          `${userToken}${ext}`,
        );
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }

      // Clear avatarUrl in DB
      await prisma.personalityConfig.update({
        where: { userToken },
        data: { avatarUrl: null },
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Avatar delete error:", err);
      res.status(500).json({ success: false, message: "Delete failed" });
    }
  },
);
