import Conversation from "../models/Conversation.js";

export async function ingestConversationMessage({ token, role, text }) {
  await Conversation.findOneAndUpdate(
    { token },
    {
      $push: {
        messages: {
          role,
          text,
          processed: false,
          createdAt: new Date(),
        },
      },
      $set: { updatedAt: new Date() },
    },
    { upsert: true }
  );
}
