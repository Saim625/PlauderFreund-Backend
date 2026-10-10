import cron from "node-cron";
import prisma from "../lib/db.js";
import { getAllSessions } from "./sessionStore.js";
import logger from "../utils/logger.js";
import { reschedule } from "../utils/rescheduleReminder.js";
import { enqueueDueRemindersForSession } from "./reminderQueue.js";

export async function cleanupReminderOccurrences(db = prisma, now = new Date()) {
  const expired = await db.reminder.findMany({
    where: { status: "active", eventDatetime: { not: null }, remindUntil: { lt: now } },
  });
  for (const reminder of expired) {
    const next = reschedule(reminder, now);
    await db.reminder.updateMany({
      // Do not overwrite a concurrent user update or delivery.
      where: { id: reminder.id, status: "active", eventDatetime: reminder.eventDatetime, updatedAt: reminder.updatedAt },
      data: next ? {
        eventDatetime: next.newEventDatetime,
        remindFrom: next.newRemindFrom,
        remindUntil: next.newRemindUntil,
        acknowledgedAt: null,
      } : { status: reminder.timesReminded > 0 ? "completed" : "expired", identityKey: null },
    });
  }
}

export function startReminderScheduler() {
  cron.schedule("*/5 * * * *", async () => {
    for (const [token, socket] of getAllSessions()) {
      try {
        const gptWs = socket.data?.gptWs;
        if (!gptWs) continue;
        await enqueueDueRemindersForSession(token, socket.id);
      } catch (err) {
        logger.error(`❌ Reminder delivery check failed: ${err.message}`);
      }
    }
  });
  logger.info("✅ Reminder scheduler started (every 5 minutes)");
}

export function startReminderCleanup() {
  // Window closure, not midnight or event time, determines when to advance.
  const run = () => cleanupReminderOccurrences().catch((err) => {
    logger.error(`❌ Reminder cleanup failed: ${err.message}`);
  });
  cron.schedule("*/5 * * * *", run);
  void run(); // Catch up missed occurrences after a server restart.
}
