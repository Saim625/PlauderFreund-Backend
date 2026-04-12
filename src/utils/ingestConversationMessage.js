import prisma from "../lib/db.js";

export async function ingestConversationMessage({ token, role, text }) {
  try {
    // Atomic find-or-create — no race condition
    const conversation = await prisma.conversation.upsert({
      where: { token },
      update: { updatedAt: new Date() },
      create: { token, updatedAt: new Date() },
    });

    await prisma.message.create({
      data: {
        role,
        text,
        processed: false,
        conversationId: conversation.id,
      },
    });
  } catch (err) {
    if (err.code === "P1001" || err.code === "P1002") {
      console.error(`⚠️ DB unreachable in ingestConversationMessage:`, err);
      return;
    }
    console.error(`❌ Unexpected DB error in ingestConversationMessage:`, err);
  }
}
