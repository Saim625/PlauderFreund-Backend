import prisma from "../lib/db.js";
import { isReminderDue } from "../utils/reminderSchedule.js";
import logger from "../utils/logger.js";
import { injectReminderIntoGPT } from "./reminderInjector.js";

// sessionId -> state
const reminderStateBySession = new Map();

function getOrCreateState(sessionId) {
  const existing = reminderStateBySession.get(sessionId);
  if (existing) return existing;

  const st = {
    queue: [],
    inFlightReminderId: null,
    contextItemId: null,
    responseItemId: null,
  };
  reminderStateBySession.set(sessionId, st);
  return st;
}

async function getDueReminders(userToken) {
  const now = new Date();

  return prisma.reminder.findMany({
    where: {
      userToken,
      status: "active",
      eventDatetime: { not: null },
      remindFrom: { lte: now },
      remindUntil: { gte: now },
    },
    orderBy: { id: "asc" },
  });
}

// The transaction claims an occurrence before sending it. Failed/uncertain sends
// are not retried: this deliberately favors at-most-once delivery over repeats.
export async function claimReminderOccurrence(reminderId, occurrenceAt, userToken, sessionId, db = prisma, now = new Date()) {
  try {
    return await db.$transaction(async (tx) => {
      const reminder = await tx.reminder.findFirst({
        where: { id: reminderId, userToken, status: "active" },
      });
      if (!reminder || !isReminderDue(reminder, now) ||
          reminder.eventDatetime.getTime() !== occurrenceAt.getTime()) return null;
      const delivered = await tx.reminderDeliveryLog.findUnique({
        where: { reminderId_occurrenceAt: { reminderId, occurrenceAt } },
      });
      if (delivered) return null;

      // Compare-and-set also excludes a simultaneous schedule edit or cleanup.
      const claimed = await tx.reminder.updateMany({
        where: { id: reminderId, userToken, status: "active", eventDatetime: occurrenceAt, updatedAt: reminder.updatedAt },
        data: {
          timesReminded: { increment: 1 },
          ...(reminder.recurrence === "none" ? { status: "completed", identityKey: null } : {}),
        },
      });
      if (!claimed.count) return null;
      await tx.reminderDeliveryLog.create({
        data: { reminderId, userToken, sessionId, occurrenceAt, deliveryStatus: "delivered" },
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
  gptWs,
) {
  const st = getOrCreateState(sessionId);
  const due = await getDueReminders(userToken);

  if (!due.length) return { enqueued: 0, totalDue: 0 };

  let enqueued = 0;
  for (const r of due) {
    if (st.inFlightReminderId === r.id) continue;
    if (st.queue.some((item) => item.id === r.id)) continue;

    const delivered = await prisma.reminderDeliveryLog.findUnique({
      where: { reminderId_occurrenceAt: { reminderId: r.id, occurrenceAt: r.eventDatetime } },
    });
    if (delivered) continue;
    // Recheck after await: another scheduler tick may have queued this reminder.
    if (st.inFlightReminderId === r.id || st.queue.some((item) => item.id === r.id)) continue;
    st.queue.push({ id: r.id, occurrenceAt: r.eventDatetime });
    enqueued++;
  }

  // If we have a live ws, inject one reminder now so it can appear in the next model response.
  if (gptWs) {
    await maybeInjectNextReminder(sessionId, userToken, gptWs);
  }

  return { enqueued, totalDue: due.length };
}

export async function maybeInjectNextReminder(sessionId, userToken, gptWs) {
  const st = reminderStateBySession.get(sessionId);
  if (!st) return false;
  if (st.inFlightReminderId) return false;
  if (!st.queue.length) return false;
  if (!gptWs || gptWs.readyState !== 1) return false; // 1 = OPEN

  while (st.queue.length) {
    const { id, occurrenceAt } = st.queue.shift();
    st.inFlightReminderId = id; // Set before awaiting to serialize this session.
    try {
      const reminder = await claimReminderOccurrence(id, occurrenceAt, userToken, sessionId);
      if (!reminder) {
        st.inFlightReminderId = null;
        continue;
      }
      st.contextItemId = injectReminderIntoGPT(gptWs, reminder);
      if (!st.contextItemId) st.inFlightReminderId = null;
      logger.info(`🔔 Reminder occurrence claimed: "${reminder.title}" [${sessionId}]`);
      return Boolean(st.contextItemId);
    } catch (err) {
      st.inFlightReminderId = null;
      throw err;
    }
  }
  return false;
}

export function markReminderResponseStarted(sessionId) {
  const st = reminderStateBySession.get(sessionId);
  if (st) st.responseItemId = st.contextItemId;
}

// Call when an assistant response finishes; allows the next reminder to be injected on the next response.
export function markReminderSlotFreeForNextResponse(sessionId, gptWs) {
  const st = reminderStateBySession.get(sessionId);
  if (!st?.responseItemId) return;
  if (gptWs?.readyState === 1) {
    gptWs.send(JSON.stringify({ type: "conversation.item.delete", item_id: st.responseItemId }));
    // Keep the ID available for acknowledgement without retaining a delivery instruction.
    gptWs.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text:
        `Reminder ID ${st.inFlightReminderId} has already been announced. Do not announce it again. If the user acknowledges it, use acknowledge_reminder with that ID.` }] },
    }));
  }
  st.contextItemId = null;
  st.responseItemId = null;
  st.inFlightReminderId = null;
}

export function clearReminderSession(sessionId) {
  reminderStateBySession.delete(sessionId);
}
