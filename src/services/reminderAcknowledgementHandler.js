import prisma from "../lib/db.js";
import { reschedule } from "../utils/rescheduleReminder.js";
import logger from "../utils/logger.js";

export async function handleReminderAcknowledgement(reminderId, sessionId) {
  const reminder = await prisma.reminder.findUnique({
    where: { id: reminderId },
  });

  if (!reminder) {
    logger.warn(
      `⚠️ Acknowledgement received for unknown reminder id: ${reminderId}`,
    );
    return;
  }

  if (reminder.status !== "active") {
    logger.info(
      `ℹ️ Reminder ${reminderId} already ${reminder.status} — skipping`,
    );
    return;
  }

  // Update delivery log to acknowledged
  await prisma.reminderDeliveryLog.updateMany({
    where: {
      reminderId,
      sessionId,
      deliveryStatus: "delivered",
    },
    data: {
      deliveryStatus: "acknowledged",
      acknowledgedAt: new Date(),
    },
  });

  const next = reschedule(reminder);

  if (next) {
    // Recurring — roll forward, keep active
    await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        eventDatetime: next.newEventDatetime,
        remindFrom: next.newRemindFrom,
        remindUntil: next.newRemindUntil,
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    logger.info(
      `🔄 Recurring reminder "${reminder.title}" rescheduled to ${next.newEventDatetime.toISOString()}`,
    );
  } else {
    // One-time — mark completed
    await prisma.reminder.update({
      where: { id: reminderId },
      data: {
        status: "completed",
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    logger.info(`✅ One-time reminder "${reminder.title}" marked as completed`);
  }
}
