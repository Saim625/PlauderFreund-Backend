import prisma from "../lib/db.js";
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
      OR: [{ remindFrom: { lte: now } }, { remindFrom: null }],
      AND: [{ OR: [{ remindUntil: { gte: now } }, { remindUntil: null }] }],
    },
    orderBy: { id: "asc" },
  });
}

async function wasAlreadyDeliveredThisSession(reminderId, sessionId) {
  const log = await prisma.reminderDeliveryLog.findFirst({
    where: {
      reminderId,
      sessionId,
      deliveryStatus: { in: ["delivered", "acknowledged"] },
    },
  });
  return !!log;
}

async function logDelivery(reminderId, userToken, sessionId) {
  await prisma.reminderDeliveryLog.create({
    data: {
      reminderId,
      userToken,
      sessionId,
      deliveryStatus: "delivered",
    },
  });

  await prisma.reminder.update({
    where: { id: reminderId },
    data: { timesReminded: { increment: 1 } },
  });
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
    if (st.queue.includes(r.id)) continue;

    const alreadyDelivered = await wasAlreadyDeliveredThisSession(
      r.id,
      sessionId,
    );
    if (alreadyDelivered) continue;

    st.queue.push(r.id);
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

  const reminderId = st.queue.shift();
  if (!reminderId) return false;

  const reminder = await prisma.reminder.findUnique({
    where: { id: reminderId },
  });
  if (!reminder || reminder.status !== "active") {
    st.inFlightReminderId = null;
    return false;
  }

  injectReminderIntoGPT(gptWs, reminder);
  await logDelivery(reminder.id, reminder.userToken ?? userToken, sessionId);
  st.inFlightReminderId = reminder.id;

  logger.info(
    `🔔 Queued reminder injected: "${reminder.title}" [${sessionId}]`,
  );
  return true;
}

// Call when an assistant response finishes; allows the next reminder to be injected on the next response.
export function markReminderSlotFreeForNextResponse(sessionId) {
  const st = reminderStateBySession.get(sessionId);
  if (!st) return;
  st.inFlightReminderId = null;
}

export function clearReminderSession(sessionId) {
  reminderStateBySession.delete(sessionId);
}
