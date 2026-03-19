import cron from "node-cron";
import prisma from "../lib/db.js";
import { getAllSessions } from "./sessionStore.js";
import { injectReminderIntoGPT } from "./reminderInjector.js";
import logger from "../utils/logger.js";
import { reschedule } from "../utils/rescheduleReminder.js";

// ---------------------------------------------------------------------------
// Core query — find all reminders that are due RIGHT NOW
// ---------------------------------------------------------------------------

async function getDueReminders(userToken = null) {
  const now = new Date();

  return prisma.reminder.findMany({
    where: {
      ...(userToken ? { userToken } : {}), // filter by user if provided
      status: "active",
      // Reminder window must have started
      OR: [{ remindFrom: { lte: now } }, { remindFrom: null }],
      // Reminder window must not have closed
      AND: [
        {
          OR: [{ remindUntil: { gte: now } }, { remindUntil: null }],
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Check if reminder was already delivered in current session
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Log delivery to DB
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Deliver a single reminder to a socket/gptWs
// ---------------------------------------------------------------------------

async function deliverReminder(reminder, socket, gptWs) {
  const sessionId = socket.id;
  const alreadyDelivered = await wasAlreadyDeliveredThisSession(
    reminder.id,
    sessionId,
  );

  if (alreadyDelivered) {
    logger.info(
      `⏭️ Reminder "${reminder.title}" already delivered this session — skipping`,
    );
    return;
  }

  injectReminderIntoGPT(gptWs, reminder);
  await logDelivery(reminder.id, reminder.userToken, sessionId);
  logger.info(
    `🔔 Delivered reminder "${reminder.title}" to session ${sessionId}`,
  );
}

// ---------------------------------------------------------------------------
// SESSION START — call this when user connects
// Fetches all due reminders and delivers them immediately
// ---------------------------------------------------------------------------

export async function deliverRemindersOnSessionStart(token, socket, gptWs) {
  try {
    const dueReminders = await getDueReminders(token);

    if (!dueReminders.length) {
      logger.info(`ℹ️ No due reminders for token ${token} at session start`);
      return;
    }

    logger.info(
      `🔔 ${dueReminders.length} due reminder(s) found at session start for token ${token}`,
    );

    for (const reminder of dueReminders) {
      await deliverReminder(reminder, socket, gptWs);
    }
  } catch (err) {
    logger.error("❌ Session-start reminder delivery failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// CRON JOB — runs every 5 minutes
// Finds due reminders for ALL active sessions and delivers mid-session
// ---------------------------------------------------------------------------

export function startReminderScheduler() {
  cron.schedule("*/5 * * * *", async () => {
    logger.info("⏰ Reminder scheduler tick...");

    const activeSessions = getAllSessions(); // Map: token → socket

    if (activeSessions.size === 0) {
      logger.info("ℹ️ No active sessions — skipping reminder check");
      return;
    }

    for (const [token, socket] of activeSessions) {
      try {
        const dueReminders = await getDueReminders(token);

        if (!dueReminders.length) continue;

        // Get gptWs from socket — we attach it in handleRealtimeAI (see below)
        const gptWs = socket.data?.gptWs;
        if (!gptWs) {
          logger.warn(`⚠️ No gptWs found on socket for token ${token}`);
          continue;
        }

        for (const reminder of dueReminders) {
          await deliverReminder(reminder, socket, gptWs);
        }
      } catch (err) {
        logger.error(
          `❌ Cron delivery failed for token ${token}:`,
          err.message,
        );
      }
    }
  });

  logger.info("✅ Reminder scheduler started (every 5 minutes)");
}

// ---------------------------------------------------------------------------
// DAILY CLEANUP — runs at midnight
// Expires reminders whose remindUntil has passed
// ---------------------------------------------------------------------------

export function startReminderCleanup() {
  cron.schedule("0 0 * * *", async () => {
    const now = new Date();

    // One-time reminders whose window passed → expire them
    await prisma.reminder.updateMany({
      where: {
        status: "active",
        recurrence: "none",
        remindUntil: { lt: now },
      },
      data: { status: "expired" },
    });

    // Recurring reminders whose window passed but NOT acknowledged → reschedule
    const missedRecurring = await prisma.reminder.findMany({
      where: {
        status: "active",
        recurrence: { not: "none" },
        remindUntil: { lt: now },
      },
    });

    for (const reminder of missedRecurring) {
      const next = reschedule(reminder); // same function from reminderAcknowledgementHandler
      if (next) {
        await prisma.reminder.update({
          where: { id: reminder.id },
          data: {
            eventDatetime: next.newEventDatetime,
            remindFrom: next.newRemindFrom,
            remindUntil: next.newRemindUntil,
            updatedAt: new Date(),
          },
        });
        logger.info(
          `🔄 Missed recurring reminder "${reminder.title}" auto-rescheduled`,
        );
      }
    }
  });
}
