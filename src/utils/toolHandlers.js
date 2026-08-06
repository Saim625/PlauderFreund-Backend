import prisma from "../lib/db.js";
import logger from "./logger.js";
import { maybeInjectNextReminder } from "../services/reminderQueue.js";

function resolveTimezoneArg(timezone) {
  if (timezone && typeof timezone === "object" && "value" in timezone) {
    return timezone.value;
  }
  return timezone;
}

async function sendToolResult(
  gptWs,
  callId,
  sessionId,
  token,
  success = true,
  data = {},
) {
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

  // If a reminder is queued, inject ONE so it can be spoken in this response.
  if (sessionId) {
    try {
      await maybeInjectNextReminder(sessionId, token, gptWs);
    } catch (err) {
      logger.error(`❌ [${sessionId}] Reminder injection failed:`, err);
    }
  }

  gptWs.send(
    JSON.stringify({
      type: "response.create",
      response: { output_modalities: ["text"] },
    }),
  );
}

async function handleGetUserReminders(args, callId, token, gptWs, timezone) {
  try {
    const { filter = "all", reminder_type = "all" } = args;
    const now = new Date();
    const safeTimezone = resolveTimezoneArg(timezone) || "UTC";

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    let whereClause = { userToken: token };

    if (filter === "upcoming") {
      // Active reminders whose window hasn't started or is currently active
      whereClause = {
        ...whereClause,
        status: "active",
        OR: [
          { eventDatetime: { gte: now } },
          { remindUntil: { gte: now } },
          { eventDatetime: null },
        ],
      };
    } else if (filter === "today") {
      // Reminders relevant to today — either event is today OR window covers today
      whereClause = {
        ...whereClause,
        OR: [
          { eventDatetime: { gte: startOfDay, lte: endOfDay } },
          {
            AND: [
              { remindFrom: { lte: endOfDay } },
              { remindUntil: { gte: startOfDay } },
            ],
          },
        ],
      };
    } else if (filter === "past") {
      // Completed/expired OR active but window has passed (missed)
      whereClause = {
        ...whereClause,
        OR: [
          { status: { in: ["completed", "expired"] } },
          {
            AND: [{ status: "active" }, { remindUntil: { lt: now } }],
          },
        ],
      };
    }
    // "all" = just userToken filter, returns everything

    if (reminder_type !== "all") {
      whereClause = { ...whereClause, reminderType: reminder_type };
    }

    const reminders = await prisma.reminder.findMany({
      where: whereClause,
      orderBy: { eventDatetime: "asc" },
      take: 20,
    });

    // Determine display status — active but window passed = "missed"
    const formatted = reminders.map((r) => {
      let displayStatus = r.status;
      if (
        r.status === "active" &&
        r.remindUntil &&
        new Date(r.remindUntil) < now
      ) {
        displayStatus = "missed";
      }

      return {
        id: r.id,
        title: r.title,
        type: r.reminderType,
        status: displayStatus,
        eventTime: r.eventDatetime,
        remindFrom: r.remindFrom,
        remindUntil: r.remindUntil,
        recurrence: r.recurrence,
        description: r.description,
      };
    });

    const formattedText =
      formatted.length === 0
        ? "No reminders found."
        : formatted
            .map((r) => {
              const localTime = r.eventTime
                ? new Date(r.eventTime).toLocaleString("de-DE", {
                    timeZone: safeTimezone,
                  })
                : "No specific date";

              return `- ${r.title} (${r.type}) | Status: ${r.status} | Event: ${localTime} (${safeTimezone}) | Repeats: ${r.recurrence}${r.description ? ` | Note: ${r.description}` : ""}`;
            })
            .join("\n");

    gptWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output:
            formatted.length === 0
              ? "No reminders found."
              : `Found ${formatted.length} reminder(s):\n${formattedText}`,
        },
      }),
    );

    gptWs.send(
      JSON.stringify({
        type: "response.create",
        response: { output_modalities: ["text"] },
      }),
    );

    logger.info(
      `📋 Fetched ${formatted.length} reminders for token ${token} (filter: ${filter})`,
    );
  } catch (err) {
    logger.error("❌ Error fetching reminders:", err);
    await sendToolResult(gptWs, callId, sessionId, token, false, {
      summary: "Failed to fetch reminders.",
    });
  }
}

async function handleUpdatePersonalityPreference(
  args,
  callId,
  sessionId,
  token,
  gptWs,
) {
  const newPreference = args.new_preference?.trim();

  if (!newPreference) {
    logger.warn(
      "⚠️ update_personality_preferences called with empty preference",
    );
    await sendToolResult(gptWs, callId, sessionId, token, false);
    return;
  }

  const config = await prisma.personalityConfig.findUnique({
    where: { userToken: token },
  });

  if (!config) {
    logger.warn(`⚠️ No PersonalityConfig found for token ${token}`);
    await sendToolResult(gptWs, callId, sessionId, token, false);
    return;
  }

  const existing = config.conversationGuidelines || [];

  // Avoid exact duplicates
  if (existing.includes(newPreference)) {
    logger.info(`ℹ️ Preference already exists, skipping: "${newPreference}"`);
    await sendToolResult(gptWs, callId, sessionId, token);
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
  await sendToolResult(gptWs, callId, sessionId, token);
}

async function handleGetCurrentTime(
  callId,
  sessionId,
  token,
  timezone,
  gptWs,
) {
  const now = new Date();
  const safeTimezone = resolveTimezoneArg(timezone) || "UTC";

  await sendToolResult(gptWs, callId, sessionId, token, true, {
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
    case "get_user_reminders":
      await handleGetUserReminders(args, call_id, token, gptWs, timezone);
      break;

    case "update_personality_preferences":
      await handleUpdatePersonalityPreference(
        args,
        call_id,
        sessionId,
        token,
        gptWs,
      );
      break;

    case "get_current_time":
      await handleGetCurrentTime(call_id, sessionId, token, timezone, gptWs);
      break;

    default:
      logger.warn(`⚠️ Unknown tool called: "${name}"`);
      await sendToolResult(gptWs, call_id, sessionId, token, false, {
        message: `Unknown tool: ${name}`,
      });
  }
}
