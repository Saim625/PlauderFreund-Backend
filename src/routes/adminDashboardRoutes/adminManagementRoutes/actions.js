import express from "express";
import { v4 as uuidv4 } from "uuid";
import prisma from "../../../lib/db.js";
import { verifyAdminToken } from "../../../middleware/verifyAdminToken.js";

export const adminActionRouter = express.Router();

function validateNameAndNumbers(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) {
    return { error: "Name is required and must be 100 characters or fewer" };
  }

  const requestedNumbers = Array.isArray(body.numbers)
    ? body.numbers
    : body.number !== undefined
      ? [body.number]
      : [];

  if (!requestedNumbers.length) {
    return { error: "At least one phone number is required" };
  }

  const numbers = requestedNumbers.map((number) =>
    typeof number === "string" ? number.trim() : "",
  );

  if (numbers.some((number) => !/^\+?\d{1,19}$/.test(number))) {
    return {
      error: "Each number must contain 1 to 19 digits (optional + prefix allowed)",
    };
  }

  if (new Set(numbers).size !== numbers.length) {
    return { error: "Each phone number may only be entered once" };
  }

  return { name, numbers };
}

async function saveUserPhoneNumbers(userTokenId, name, numbers) {
  return prisma.$transaction(async (tx) => {
    await tx.userAccessToken.update({
      where: { id: userTokenId },
      data: { name },
    });

    await tx.userPhoneNumber.deleteMany({
      where: { userAccessTokenId: userTokenId },
    });

    await tx.userPhoneNumber.createMany({
      data: numbers.map((number) => ({
        number,
        userAccessTokenId: userTokenId,
      })),
    });

    return tx.userAccessToken.findUnique({
      where: { id: userTokenId },
      include: { phoneNumbers: { orderBy: { id: "asc" } } },
    });
  });
}

/**
 * Get all admins
 * Only accessible by MAIN_ADMIN (we enforce below)
 */
adminActionRouter.get(
  "/admins",
  verifyAdminToken(), // anyone with admin token can hit, we'll block non-MAIN_ADMIN below
  async (req, res) => {
    try {
      // Only MAIN_ADMIN can fetch the full admin list
      if (req.admin.role !== "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Only Main Admin allowed" });
      }

      const admins = await prisma.adminAccessToken.findMany();
      return res.json({ success: true, admins });
    } catch (err) {
      console.error("Get admins error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

adminActionRouter.post(
  "/admins",
  verifyAdminToken(), // must be admin; check role inside
  async (req, res) => {
    try {
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can create admins",
        });
      }

      // Read desired role/permissions from body (optional). By default new admin = ADMIN
      const { role = "ADMIN", permissions = {} } = req.body;

      // generate token (alphanumeric)
      const token = uuidv4().replace(/-/g, "").slice(0, 7);

      const newAdmin = await prisma.adminAccessToken.create({
        data: {
          token,
          role,
          canManageUsers: !!permissions.canManageUsers,
          canCreateTokens: !!permissions.canCreateTokens,
          canDeleteTokens: !!permissions.canDeleteTokens,
          canEditAdmin: !!permissions.canEditAdmin,
          canAccessMemoryEditor: !!permissions.canAccessMemoryEditor,
          canAccessPersonalisedConfig:
            !!permissions.canAccessPersonalisedConfig,
        },
      });

      return res.json({
        success: true,
        message: "Admin created",
        admin: newAdmin,
        inviteUrl: `https://plauderfreund.de/admin?token=${token}`,
      });
    } catch (err) {
      console.error("Create admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

adminActionRouter.put(
  "/admins/:id/toggle-status",
  verifyAdminToken(),
  async (req, res) => {
    try {
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can toggle admins",
        });
      }

      const target = await prisma.adminAccessToken.findUnique({
        where: { id: parseInt(req.params.id) },
      });

      if (!target)
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });

      // Prevent toggling main admin by others (and prevent main admin toggling themself accidentally)
      if (target.role === "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Main Admin cannot be toggled" });
      }

      const updated = await prisma.adminAccessToken.update({
        where: { id: target.id },
        data: { isActive: !target.isActive },
      });

      target.isActive = updated.isActive;

      return res.json({
        success: true,
        message: "Status updated",
        admin: target,
      });
    } catch (err) {
      console.error("Toggle admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

/**
 * Delete admin (cannot delete MAIN_ADMIN or self)
 */
adminActionRouter.delete(
  "/admins/:id",
  verifyAdminToken(),
  async (req, res) => {
    try {
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can delete admins",
        });
      }

      const target = await prisma.adminAccessToken.findUnique({
        where: { id: parseInt(req.params.id) },
      });

      if (!target)
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });

      if (target.role === "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Main Admin cannot be deleted" });
      }

      if (target.token === req.admin.token) {
        return res.status(400).json({
          success: false,
          message: "You cannot delete your own admin token",
        });
      }

      await prisma.adminAccessToken.delete({
        where: { id: target.id },
      });
      return res.json({ success: true, message: "Admin deleted" });
    } catch (err) {
      console.error("Delete admin error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

/**
 * Edit own token (admin can update their own token string)
 * Everyone can update their own token; MAIN_ADMIN protection handled elsewhere
 */
adminActionRouter.put(
  "/admins/:id/edit-token",
  verifyAdminToken(),
  async (req, res) => {
    try {
      const { newToken } = req.body;
      if (!newToken)
        return res
          .status(400)
          .json({ success: false, message: "newToken is required" });

      const target = await prisma.adminAccessToken.findUnique({
        where: { id: parseInt(req.params.id) },
      });

      if (!target)
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });

      // 1️⃣ Block editing MAIN_ADMIN token unless user is MAIN_ADMIN
      if (target.role === "MAIN_ADMIN" && req.admin.role !== "MAIN_ADMIN") {
        return res
          .status(403)
          .json({ success: false, message: "Cannot edit Main Admin token" });
      }

      // 2️⃣ Allow editing if the user is the admin themselves or MAIN_ADMIN
      if (target.token !== req.admin.token && req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Not allowed to edit this admin token",
        });
      }

      const updated = await prisma.adminAccessToken.update({
        where: { id: target.id },
        data: { token: newToken },
      });

      target.token = updated.token;

      return res.json({
        success: true,
        message: "Token updated",
        admin: target,
      });
    } catch (err) {
      console.error("Edit admin token error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// Assign a name and phone numbers to a user token (MAIN_ADMIN only)
adminActionRouter.post(
  "/token/:id/assign-number",
  verifyAdminToken(), // Must be admin
  async (req, res) => {
    try {
      // Only MAIN_ADMIN can assign numbers
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can assign numbers",
        });
      }

      const userTokenId = parseInt(req.params.id);
      if (isNaN(userTokenId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid token ID",
        });
      }

      const validated = validateNameAndNumbers(req.body);
      if (validated.error) {
        return res.status(400).json({ success: false, message: validated.error });
      }

      // Check if token exists
      const userRecord = await prisma.userAccessToken.findUnique({
        where: { id: userTokenId },
      });

      if (!userRecord) {
        return res.status(404).json({
          success: false,
          message: "User token not found",
        });
      }

      // A phone number can only belong to one user token.
      const existingNumber = await prisma.userPhoneNumber.findFirst({
        where: {
          number: { in: validated.numbers },
          userAccessTokenId: { not: userTokenId },
        },
      });

      if (existingNumber) {
        return res.status(400).json({
          success: false,
          message: "One or more phone numbers are already assigned to another token",
        });
      }

      const updated = await saveUserPhoneNumbers(
        userTokenId,
        validated.name,
        validated.numbers,
      );

      return res.json({
        success: true,
        message: "Name and phone numbers assigned successfully",
        data: {
          id: updated.id,
          token: updated.token,
          name: updated.name,
          phoneNumbers: updated.phoneNumbers,
        },
      });
    } catch (err) {
      console.error("Assign phone numbers error:", err);

      // Handle unique constraint violation
      if (err.code === "P2002") {
        return res.status(400).json({
          success: false,
          message: "One or more phone numbers are already assigned to another token",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Server error",
        err,
      });
    }
  },
);

// Update an assigned name and phone numbers (MAIN_ADMIN only)
adminActionRouter.put(
  "/token/:id/update-number",
  verifyAdminToken(), // Must be admin
  async (req, res) => {
    try {
      // Only MAIN_ADMIN can update numbers
      if (req.admin.role !== "MAIN_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only Main Admin can update numbers",
        });
      }

      const userTokenId = parseInt(req.params.id);
      if (isNaN(userTokenId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid token ID",
        });
      }

      const validated = validateNameAndNumbers(req.body);
      if (validated.error) {
        return res.status(400).json({ success: false, message: validated.error });
      }

      // Check if token exists
      const userRecord = await prisma.userAccessToken.findUnique({
        where: { id: userTokenId },
      });

      if (!userRecord) {
        return res.status(404).json({
          success: false,
          message: "User token not found",
        });
      }

      // A phone number can only belong to one user token.
      const existingNumber = await prisma.userPhoneNumber.findFirst({
        where: {
          number: { in: validated.numbers },
          userAccessTokenId: { not: userTokenId },
        },
      });

      if (existingNumber) {
        return res.status(400).json({
          success: false,
          message: "One or more phone numbers are already assigned to another token",
        });
      }

      const updated = await saveUserPhoneNumbers(
        userTokenId,
        validated.name,
        validated.numbers,
      );

      return res.json({
        success: true,
        message: "Name and phone numbers updated successfully",
        data: {
          id: updated.id,
          token: updated.token,
          name: updated.name,
          phoneNumbers: updated.phoneNumbers,
        },
      });
    } catch (err) {
      console.error("Update phone numbers error:", err);

      // Handle unique constraint violation
      if (err.code === "P2002") {
        return res.status(400).json({
          success: false,
          message: "One or more phone numbers are already assigned to another token",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  },
);
