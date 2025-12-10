import mongoose from "mongoose";

const adminAccessTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
  },

  role: {
    type: String,
    enum: ["MAIN_ADMIN", "ADMIN"],
    default: "ADMIN",
  },

  isActive: {
    type: Boolean,
    default: true,
  },

  permissions: {
    canManageUsers: { type: Boolean, default: false },
    canCreateTokens: { type: Boolean, default: false },
    canDeleteTokens: { type: Boolean, default: false },
    canEditAdmin: { type: Boolean, default: false },
    canAccessMemoryEditor: { type: Boolean, default: false },
    canAccessPersonalisedConfig: { type: Boolean, default: false },
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("AdminAccessToken", adminAccessTokenSchema);
