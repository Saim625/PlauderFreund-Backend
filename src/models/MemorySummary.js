import mongoose from "mongoose";

const memorySummarySchema = new mongoose.Schema({
  token: {
    type: String,
    required: true, // since user identity is based on token
    unique: true,
  },
  summary: [
    {
      category: String, // e.g. "personality", "interest", "goal", "emotion"
      key: String, // short identifier like "communicationStyle"
      value: String, // actual information: "User prefers calm and supportive tone"
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("MemorySummary", memorySummarySchema);
