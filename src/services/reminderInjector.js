/**
 * Injects a reminder into the active GPT realtime session.
 * Sends it as a hidden system message so GPT weaves it naturally
 * into its next response — without feeling robotic.
 *
 * @param {WebSocket} gptWs - The active GPT realtime WebSocket
 * @param {Object} reminder - Reminder object from DB
 */
export function injectReminderIntoGPT(gptWs, reminder) {
  if (!gptWs || gptWs.readyState !== 1) return; // 1 = OPEN

  const reminderText = reminder.description
    ? `${reminder.title} — ${reminder.description}`
    : reminder.title;

  // Step 1: Inject reminder as hidden system context
  gptWs.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: `[REMINDER ID:${reminder.id}] The user has a pending reminder: "${reminderText}". 
Acknowledge it warmly and naturally in your next response — as if you remembered it yourself. 
Keep it brief. Do not make it feel like an automated notification.
Example style: "Ach, übrigens — vergiss nicht, ..." (adapt to conversation language).
After mentioning it, continue the conversation normally. If the user responds that they have already done it, taken it, or are aware — call the acknowledge_reminder function with reminder_id: ${reminder.id}.`,
          },
        ],
      },
    }),
  );
}
