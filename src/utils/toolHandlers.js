import prisma from "../lib/db.js";
import { handleReminderAcknowledgement } from "../services/reminderAcknowledgementHandler.js";
import logger from "./logger.js";

function sendToolResult(gptWs, callId) {
  gptWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ success: true }),
      },
    }),
  );
  gptWs.send(
    JSON.stringify({
      type: "response.create",
      response: { output_modalities: ["text"] },
    }),
  );
}

async function handleAcknowledgeReminder(args, callId, sessionId, gptWs) {
  const reminderId = Number(args.reminder_id);
  await handleReminderAcknowledgement(reminderId, sessionId);
  sendToolResult(gptWs, callId);
  logger.info(`✅ Tool: acknowledge_reminder — id ${reminderId}`);
}

async function handleUpdatePersonalityPreference(args, callId, token, gptWs) {
  const newPreference = args.new_preference?.trim();

  if (!newPreference) {
    logger.warn(
      "⚠️ Tool: update_personality_preferences — empty preference, skipping",
    );
    sendToolResult(gptWs, callId);
    return;
  }

  const config = await prisma.personalityConfig.findUnique({
    where: { userToken: token },
  });

  if (!config) {
    logger.warn(
      `⚠️ Tool: update_personality_preferences — no config found for token ${token}`,
    );
    sendToolResult(gptWs, callId);
    return;
  }

  const existing = config.conversationGuidelines || [];

  // Avoid exact duplicates
  if (existing.includes(newPreference)) {
    logger.info(
      `ℹ️ Tool: update_personality_preferences — already exists, skipping`,
    );
    sendToolResult(gptWs, callId);
    return;
  }

  await prisma.personalityConfig.update({
    where: { userToken: token },
    data: {
      conversationGuidelines: [...existing, newPreference],
      updatedAt: new Date(),
    },
  });

  logger.info(
    `✅ Tool: update_personality_preferences — saved: "${newPreference}"`,
  );
  sendToolResult(gptWs, callId);
}

export async function handleToolCall(event, sessionId, token, gptWs) {
  const { name, call_id, arguments: rawArgs } = event;

  let args;
  try {
    args = JSON.parse(rawArgs);
  } catch (err) {
    logger.error(
      `❌ Tool: failed to parse arguments for "${name}":`,
      err.message,
    );
    return;
  }

  try {
    if (name === "acknowledge_reminder") {
      await handleAcknowledgeReminder(args, call_id, sessionId, gptWs);
    } else if (name === "update_personality_preferences") {
      await handleUpdatePersonalityPreference(args, call_id, token, gptWs);
    } else {
      logger.warn(`⚠️ Tool: unknown tool called — "${name}"`);
    }
  } catch (err) {
    logger.error(`❌ Tool "${name}" failed:`, err.message);
  }
}
