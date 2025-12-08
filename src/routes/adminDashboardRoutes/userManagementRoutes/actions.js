import express from "express";
import UserAccessToken from "../../../models/UserAccessToken.js";
import { verifyToken } from "../../../middleware/verifyToken.js";
import { v4 as uuidv4 } from "uuid";
export const actionRouter = express.Router();

actionRouter.put(
  "/token/:id/toggle-status",
  verifyToken("admin"),
  async (req, res) => {
    try {
      const userTokenId = req.params.id;

      const userRecord = await UserAccessToken.findById(userTokenId);

      if (!userRecord) {
        return res.status(404).json({
          success: false,
          message: "User token not found",
        });
      }

      // 🛑 Prevent admin from modifying their own token
      if (userRecord.token === req.user.token) {
        return res.status(400).json({
          success: false,
          message: "Admin cannot modify their own token",
        });
      }

      // Toggle status
      userRecord.isActive = !userRecord.isActive;
      await userRecord.save();

      return res.json({
        success: true,
        message: `Token status changed to ${
          userRecord.isActive ? "ACTIVE" : "INACTIVE"
        }`,
        data: userRecord,
      });
    } catch (err) {
      console.error("Toggle error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

actionRouter.delete("/token/:id", verifyToken("admin"), async (req, res) => {
  try {
    const tokenId = req.params.id;

    // 1. Find record
    const userRecord = await UserAccessToken.findById(tokenId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        message: "User token not found",
      });
    }

    // 2. Prevent admin from deleting their own token
    if (userRecord.token === req.user.token) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own token",
      });
    }

    // 3. OPTIONAL → Block admin deleting other admins
    if (userRecord.isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Admin tokens cannot be deleted",
      });
    }

    // 4. Finally delete
    await UserAccessToken.findByIdAndDelete(tokenId);

    return res.json({
      success: true,
      message: "Token deleted successfully",
      deletedId: tokenId,
    });
  } catch (err) {
    console.error("Delete error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Generate 6-7 character alphanumeric token
function generateAlphaNumericToken(length = 7) {
  return uuidv4().replace(/-/g, "").slice(0, length);
}

actionRouter.post("/token/generate", verifyToken("admin"), async (req, res) => {
  try {
    const token = generateAlphaNumericToken(7); // 7-char alphanumeric

    const record = await UserAccessToken.create({
      token,
      isAdmin: false,
      isActive: true,
    });

    return res.json({
      success: true,
      message: "User invitation token generated",
      token,
      inviteUrl: `https://plauderfreund.de/?token=${token}`,
      id: record._id,
    });
  } catch (err) {
    console.error("Generate token error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while generating token",
    });
  }
});
