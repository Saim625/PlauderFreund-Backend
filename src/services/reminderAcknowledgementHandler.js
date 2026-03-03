import prisma from "../lib/db.js";
import logger from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Reschedule helpers — roll all time fields forward by one interval
// ---------------------------------------------------------------------------

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function reschedule(reminder) {
  const { recurrence, eventDatetime, remindFrom, remindUntil } = reminder;

  // If no eventDatetime, we can't reschedule time-based — just leave as is
  if (!eventDatetime) return null;

  let newEventDatetime, newRemindFrom, newRemindUntil;

  if (recurrence === "daily") {
    newEventDatetime = addDays(eventDatetime, 1);
    newRemindFrom = remindFrom ? addDays(remindFrom, 1) : null;
    newRemindUntil = remindUntil ? addDays(remindUntil, 1) : null;
  } else if (recurrence === "weekly") {
    newEventDatetime = addDays(eventDatetime, 7);
    newRemindFrom = remindFrom ? addDays(remindFrom, 7) : null;
    newRemindUntil = remindUntil ? addDays(remindUntil, 7) : null;
  } else if (recurrence === "yearly") {
    newEventDatetime = addYears(eventDatetime, 1);
    newRemindFrom = remindFrom ? addYears(remindFrom, 1) : null;
    newRemindUntil = remindUntil ? addYears(remindUntil, 1) : null;
  } else {
    return null; // recurrence = 'none', no reschedule
  }

  return { newEventDatetime, newRemindFrom, newRemindUntil };
}

// ---------------------------------------------------------------------------
// Main handler — called when GPT function call fires
// ---------------------------------------------------------------------------

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

  // Try to reschedule if recurring
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
