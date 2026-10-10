import { reminderTimeContext } from "../utils/reminderSchedule.js";
import { randomUUID } from "node:crypto";

/**
 * Injects a reminder into the active GPT realtime session.
 * Sends it as a hidden system message so GPT weaves it naturally
 * into its next response — without feeling robotic.
 *
 * @param {WebSocket} gptWs - The active GPT realtime WebSocket
 * @param {Object} reminder - Reminder object from DB
 */
export function injectReminderIntoGPT(gptWs, reminder, now = new Date()) {
  if (!gptWs || gptWs.readyState !== 1) return; // 1 = OPEN

  const reminderText = reminder.description
    ? `${reminder.title} — ${reminder.description}`
    : reminder.title;

  const itemId = `rem_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

  // Step 1: Inject reminder as hidden system context
  gptWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        id: itemId,
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: `[REMINDER ID:${reminder.id}] Activity: "${reminderText}". Scheduled: ${reminderTimeContext(reminder, now)}.
Answer the user's current message normally FIRST. Then add one short, natural sentence about this activity, in the user's language, within the same response. Do not replace the answer with a reminder or announce that the user "set a reminder".
Use the supplied day accurately: "tomorrow" / "morgen" for tomorrow, "today" / "heute" for today, and the date for other days. If the time has passed, say it was scheduled then; do not describe it as upcoming or tell the user to take a missed medication dose.
Mention it once only today unless the user asks. If the user acknowledges it, call acknowledge_reminder with reminder_id: ${reminder.id}.`,
          },
        ],
      },
    }),
  );
  return itemId;
}
