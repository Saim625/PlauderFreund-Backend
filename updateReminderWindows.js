// Add to updateReminderWindows.js or run separately

import prisma from "./src/lib/db.js";

const medicationsToFix = await prisma.reminder.findMany({
  where: {
    reminderType: "medication",
    status: "active",
    eventDatetime: { not: null },
  },
});

for (const reminder of medicationsToFix) {
  const event = new Date(reminder.eventDatetime);
  const newRemindUntil = new Date(event.getTime() + 720 * 60 * 1000); // 12 hours after

  await prisma.reminder.update({
    where: { id: reminder.id },
    data: {
      remindUntil: newRemindUntil,
      updatedAt: new Date(),
    },
  });
  console.log(
    `✅ Updated remind_until for "${reminder.title}" to ${newRemindUntil.toISOString()}`,
  );
}
