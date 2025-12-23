import mongoose from "mongoose";

const adminAccountPasswordSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["MAIN_ADMIN"],
    required: true,
  },

  email: {
    type: String,
    required: true,
    unique: true,
    default: "kontakt@seniorenassistenz-henning.de",
  },

  passwordHash: {
    type: String,
    required: true,
  },

  // Forgot password fields
  resetPasswordToken: {
    type: String,
  },

  resetPasswordTokenExpiresAt: {
    type: Date,
  },

  isActive: {
    type: Boolean,
    default: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model(
  "AdminAccountPassword",
  adminAccountPasswordSchema
);
