import prisma from "../lib/db.js";
import { handleReminderAcknowledgement } from "../services/reminderAcknowledgementHandler.js";
import logger from "./logger.js";

function sendToolResult(gptWs, callId, success = true, data = {}) {
  gptWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ success, ...data }),
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
  logger.info(`✅ Reminder ${reminderId} acknowledged`);
}

async function handleUpdatePersonalityPreference(args, callId, token, gptWs) {
  const newPreference = args.new_preference?.trim();

  if (!newPreference) {
    logger.warn(
      "⚠️ update_personality_preferences called with empty preference",
    );
    sendToolResult(gptWs, callId, false);
    return;
  }

  const config = await prisma.personalityConfig.findUnique({
    where: { userToken: token },
  });

  if (!config) {
    logger.warn(`⚠️ No PersonalityConfig found for token ${token}`);
    sendToolResult(gptWs, callId, false);
    return;
  }

  const existing = config.conversationGuidelines || [];

  // Avoid exact duplicates
  if (existing.includes(newPreference)) {
    logger.info(`ℹ️ Preference already exists, skipping: "${newPreference}"`);
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

  logger.info(`✅ Preference saved for ${token}: "${newPreference}"`);
  sendToolResult(gptWs, callId);
}

function handleGetCurrentTime(callId, timezone, gptWs) {
  const now = new Date();
  const safeTimezone = timezone || "UTC";

  sendToolResult(gptWs, callId, true, {
    utc: now.toISOString(),
    timezone: safeTimezone,
    localTime: now.toLocaleString("de-DE", {
      timeZone: safeTimezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  });

  logger.info(
    `🕐 Time requested — timezone: ${safeTimezone}, time: ${now.toISOString()}`,
  );
}

export async function handleToolCall(event, sessionId, token, gptWs, timezone) {
  const { name, call_id, arguments: rawArgs } = event;

  let args;
  try {
    args = JSON.parse(rawArgs);
  } catch (err) {
    logger.error(
      `❌ Failed to parse tool arguments for "${name}":`,
      err.message,
    );
    return;
  }

  switch (name) {
    case "acknowledge_reminder":
      await handleAcknowledgeReminder(args, call_id, sessionId, gptWs);
      break;

    case "update_personality_preferences":
      await handleUpdatePersonalityPreference(args, call_id, token, gptWs);
      break;

    case "get_current_time":
      handleGetCurrentTime(call_id, timezone, gptWs);
      break;

    default:
      logger.warn(`⚠️ Unknown tool called: "${name}"`);
  }
}
