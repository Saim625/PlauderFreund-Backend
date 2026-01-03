import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ["user", "ai"],
    required: true,
  },
  text: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  processed: {
    type: Boolean,
    default: false,
  },
});

const ConversationSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true, // one document per user/session
    index: true,
  },
  messages: [MessageSchema],
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Conversation", ConversationSchema);
