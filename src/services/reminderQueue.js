import prisma from "../lib/db.js";
import { isReminderDue, reminderDeliveryDate } from "../utils/reminderSchedule.js";
import logger from "../utils/logger.js";
import { injectReminderIntoGPT } from "./reminderInjector.js";

// sessionId -> state
const reminderStateBySession = new Map();

function getOrCreateState(sessionId) {
  const existing = reminderStateBySession.get(sessionId);
  if (existing) return existing;

  const st = {
    queue: [],
    userMessages: new Set(),
    responseActive: false,
    preparing: false,
    pendingReminder: null,
    inFlightReminderId: null,
    contextItemId: null,
    contextDeliveryDate: null,
    responseItemId: null,
  };
  reminderStateBySession.set(sessionId, st);
  return st;
}

async function getDueReminders(userToken, now) {
  return prisma.reminder.findMany({
    where: {
      userToken,
      status: "active",
      eventDatetime: { not: null },
      remindFrom: { lte: now },
      remindUntil: { gte: now },
    },
    orderBy: [{ eventDatetime: "asc" }, { id: "asc" }],
  });
}

// The transaction claims the local delivery day before sending context.
// Failed/uncertain sends are not retried on that day to avoid repeated reminders.
export async function claimReminderOccurrence(reminderId, occurrenceAt, userToken, sessionId, db = prisma, now = new Date()) {
  try {
    return await db.$transaction(async (tx) => {
      const reminder = await tx.reminder.findFirst({
        where: { id: reminderId, userToken, status: "active" },
      });
      if (!reminder || !isReminderDue(reminder, now) ||
          reminder.eventDatetime.getTime() !== occurrenceAt.getTime()) return null;
      const deliveryDate = reminderDeliveryDate(reminder, now);
      const delivered = await tx.reminderDeliveryLog.findUnique({
        where: { reminderId_deliveryDate: { reminderId, deliveryDate } },
      });
      if (delivered) return null;

      // Compare-and-set also excludes a simultaneous schedule edit or cleanup.
      const claimed = await tx.reminder.updateMany({
        where: { id: reminderId, userToken, status: "active", eventDatetime: occurrenceAt, updatedAt: reminder.updatedAt },
        data: {
          timesReminded: { increment: 1 },
        },
      });
      if (!claimed.count) return null;
      await tx.reminderDeliveryLog.create({
        data: { reminderId, userToken, sessionId, occurrenceAt, deliveryDate, deliveredAt: now, deliveryStatus: "delivered" },
      });
      return reminder;
    });
  } catch (err) {
    if (err.code === "P2002") return null; // Another session claimed it first.
    throw err;
  }
}

export async function enqueueDueRemindersForSession(
  userToken,
  sessionId,
  now = new Date(),
) {
  const st = getOrCreateState(sessionId);
  const due = await getDueReminders(userToken, now);

  let enqueued = 0;
  const alreadyAttempted = [];
  for (const r of due) {
    if (st.inFlightReminderId === r.id) continue;
    if (st.queue.some((item) => item.id === r.id)) continue;

    const delivered = await prisma.reminderDeliveryLog.findUnique({
      where: { reminderId_deliveryDate: { reminderId: r.id, deliveryDate: reminderDeliveryDate(r, now) } },
    });
    if (delivered) { alreadyAttempted.push(r.id); continue; }
    // Recheck after await: another scheduler tick may have queued this reminder.
    if (st.inFlightReminderId === r.id || st.queue.some((item) => item.id === r.id)) continue;
    st.queue.push({ id: r.id, occurrenceAt: r.eventDatetime });
    enqueued++;
  }

  logger.info(`[${sessionId}] REMINDER_CHECK ${JSON.stringify({
    at: now.toISOString(), userMessages: st.userMessages.size,
    dueIds: due.map((r) => r.id), alreadyAttemptedToday: alreadyAttempted,
    queuedIds: st.queue.map((r) => r.id), responseActive: st.responseActive,
  })}`);
  return { enqueued, totalDue: due.length };
}

export function recordReminderUserMessage(sessionId, itemId) {
  const st = getOrCreateState(sessionId);
  if (itemId) st.userMessages.add(itemId);
}

export function hasPendingReminder(sessionId) {
  const st = reminderStateBySession.get(sessionId);
  return Boolean(st?.preparing || st?.pendingReminder || st?.contextItemId);
}

// All automatic delivery paths share this gate. The scheduler only queues.
export async function maybeInjectNextReminder(sessionId, userToken, gptWs, now = new Date()) {
  const st = reminderStateBySession.get(sessionId);
  if (!st) return false;
  const reason = st.userMessages.size < 3 ? "waiting_for_three_user_messages"
    : st.responseActive ? "waiting_for_response_end"
    : st.preparing ? "preparation_in_progress"
    : st.contextItemId ? "context_already_prepared" : null;
  if (reason) {
    if (st.queue.length || st.pendingReminder || st.contextItemId) {
      logger.info(`[${sessionId}] REMINDER_DEFERRED reason=${reason} userMessages=${st.userMessages.size}`);
    }
    return false;
  }
  if (!gptWs || gptWs.readyState !== 1) return false;
  st.preparing = true;
  try {
    while (st.pendingReminder || st.queue.length) {
      if (!st.pendingReminder) {
        const { id, occurrenceAt } = st.queue.shift();
        st.inFlightReminderId = id;
        const reminder = await claimReminderOccurrence(id, occurrenceAt, userToken, sessionId, prisma, now);
        if (!reminder) { st.inFlightReminderId = null; continue; }
        st.pendingReminder = { reminder, deliveryDate: reminderDeliveryDate(reminder, now) };
      }
      // An automatic response can start during the DB await. Wait for its end.
      if (st.responseActive || reminderStateBySession.get(sessionId) !== st || gptWs.readyState !== 1) return false;
      const { reminder: claimed, deliveryDate } = st.pendingReminder;
      const reminder = await prisma.reminder.findFirst({ where: { id: claimed.id, userToken } });
      if (st.responseActive || reminderStateBySession.get(sessionId) !== st || gptWs.readyState !== 1) return false;
      st.pendingReminder = null;
      if (!reminder || !isReminderDue(reminder, now) ||
          reminder.eventDatetime.getTime() !== claimed.eventDatetime.getTime() ||
          reminderDeliveryDate(reminder, now) !== deliveryDate) {
        st.inFlightReminderId = null;
        continue;
      }
      st.contextDeliveryDate = deliveryDate;
      st.contextItemId = injectReminderIntoGPT(gptWs, reminder, now);
      logger.info(`🔔 Daily reminder injected: "${reminder.title}" [${sessionId}] date=${deliveryDate}`);
      return Boolean(st.contextItemId);
    }
    return false;
  } finally {
    st.preparing = false;
    if (!st.pendingReminder && !st.contextItemId) st.inFlightReminderId = null;
  }
}

export function markReminderResponseStarted(sessionId) {
  const st = getOrCreateState(sessionId);
  st.responseActive = true;
  st.responseItemId = st.contextItemId;
  if (st.contextItemId) {
    logger.info(`[${sessionId}] REMINDER_RESPONSE_STARTED reminderId=${st.inFlightReminderId} itemId=${st.contextItemId}`);
  }
}

// Call when an assistant response finishes; allows the next reminder to be injected on the next response.
export function markReminderSlotFreeForNextResponse(sessionId, gptWs, response) {
  const st = reminderStateBySession.get(sessionId);
  if (!st) return;
  st.responseActive = false;
  if (!st.responseItemId) return;
  logger.info(`[${sessionId}] REMINDER_RESPONSE_FINISHED reminderId=${st.inFlightReminderId} status=${response?.status ?? "unknown"}`);
  // A tool-only response has not spoken yet; retain context for its continuation.
  if (response?.status === "completed" && response.output?.some((item) => item.type === "function_call") &&
      !response.output.some((item) => item.content?.some((part) => part.text?.trim() || part.transcript?.trim()))) {
    st.responseItemId = null;
    return;
  }
  if (gptWs?.readyState === 1) {
    gptWs.send(JSON.stringify({ type: "conversation.item.delete", item_id: st.responseItemId }));
    // Keep the ID available for acknowledgement without retaining a delivery instruction.
    gptWs.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text:
        `Reminder ID ${st.inFlightReminderId} has been handled for ${st.contextDeliveryDate}. Do not announce it again on that date. If the user acknowledges it, use acknowledge_reminder with that ID.` }] },
    }));
  }
  st.contextItemId = null;
  st.contextDeliveryDate = null;
  st.responseItemId = null;
  st.inFlightReminderId = null;
}

export function clearReminderSession(sessionId) {
  reminderStateBySession.delete(sessionId);
}
