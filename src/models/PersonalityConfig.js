import mongoose from "mongoose";
import { ELEVENLABS_VOICE_ID } from "../config/env.js";

const PersonalityConfigSchema = new mongoose.Schema(
  {
    // 🔗 Link to user token
    userToken: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },

    voiceId: {
      type: String,
      required: true,
      default: ELEVENLABS_VOICE_ID,
      trim: true,
    },
    // 🗣 Speaking behavior
    speakingSpeed: {
      type: String,
      enum: ["slow", "normal", "fast"],
      default: "normal",
    },

    empathyLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },

    // 💬 Engagement behavior
    activePrompting: {
      type: Boolean,
      default: true,
    },

    reminderOffers: {
      type: Boolean,
      default: true,
    },

    reengageAfterSilence: {
      type: Boolean,
      default: true,
    },

    // 🧠 Expertise / communication mode
    // 🎓 Domain expertise
    expertise: {
      type: String,
      enum: [
        "general",
        "psychology",
        "meditation",
        "productivity",
        "coaching",
        "therapy",
      ],
      default: "general",
    },

    // 🎭 Personality traits (boolean toggles)
    traits: {
      calm: { type: Boolean, default: true },
      humorous: { type: Boolean, default: false },
      supportive: { type: Boolean, default: true },
      direct: { type: Boolean, default: false },
    },

    // 📜 Conversation constraints / rules
    conversationGuidelines: {
      type: [String],
      default: [],
    },

    // 🔄 Admin / system control
    isActive: {
      type: Boolean,
      default: true,
    },

    updatedBy: {
      type: String, // admin id/email (optional)
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("PersonalityConfig", PersonalityConfigSchema);
