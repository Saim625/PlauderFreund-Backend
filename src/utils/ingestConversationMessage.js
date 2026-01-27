import prisma from "../lib/db.js";

export async function ingestConversationMessage({ token, role, text }) {
  // Find or create conversation
  let conversation = await prisma.conversation.findUnique({
    where: { token },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        token,
        updatedAt: new Date(),
      },
    });
  }

  // Create message
  await prisma.message.create({
    data: {
      role,
      text,
      processed: false,
      conversationId: conversation.id,
    },
  });

  // Update conversation timestamp
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });
}
