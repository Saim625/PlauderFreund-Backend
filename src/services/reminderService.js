import prisma from "../lib/db.js";

// ---------------------------------------------------------------------------
// 1. Validate & normalize a single raw reminder from GPT output
// ---------------------------------------------------------------------------

function normalizeReminder(raw) {
  // title is the only truly required field — skip if missing
  if (!raw.title || typeof raw.title !== "string" || !raw.title.trim()) {
    return null;
  }

  const validTypes = ["medication", "appointment", "birthday", "general"];
  const validRecurrences = ["none", "daily", "weekly", "yearly"];

  const safeDate = (val) => {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const reminder = {
    title: raw.title.trim(),
    description: raw.description?.trim() || null,
    reminderType: validTypes.includes(raw.reminder_type)
      ? raw.reminder_type
      : "general",
    eventDatetime: safeDate(raw.event_datetime),
    remindFrom: safeDate(raw.remind_from),
    remindUntil: safeDate(raw.remind_until),
    recurrence: validRecurrences.includes(raw.recurrence)
      ? raw.recurrence
      : "none",
  };

  // After building the reminder object, add this safety check:
  if (reminder.reminderType === "medication" && reminder.eventDatetime) {
    const event = new Date(reminder.eventDatetime);
    // If remindFrom is missing or wrong, fix it
    if (!reminder.remindFrom || reminder.remindFrom >= event) {
      reminder.remindFrom = new Date(event.getTime() - 60 * 60 * 1000); // 1 hour before
    }
    // If remindUntil is missing or same as event, fix it
    if (
      !reminder.remindUntil ||
      Math.abs(reminder.remindUntil - event) < 60000
    ) {
      reminder.remindUntil = new Date(event.getTime() + 720 * 60 * 1000); // 12 hours after
    }
  }

  return reminder;
}

// ---------------------------------------------------------------------------
// 2. Upsert — update if same title+type exists and is active, else create
// ---------------------------------------------------------------------------

async function upsertReminder(userToken, reminder) {
  const existing = await prisma.reminder.findFirst({
    where: {
      userToken,
      title: reminder.title,
      reminderType: reminder.reminderType,
      status: "active",
    },
  });

  if (existing) {
    // Only overwrite fields where new value is non-null
    await prisma.reminder.update({
      where: { id: existing.id },
      data: {
        description: reminder.description ?? existing.description,
        eventDatetime: reminder.eventDatetime ?? existing.eventDatetime,
        remindFrom: reminder.remindFrom ?? existing.remindFrom,
        remindUntil: reminder.remindUntil ?? existing.remindUntil,
        recurrence: reminder.recurrence ?? existing.recurrence,
        updatedAt: new Date(),
      },
    });
    console.log(`🔄 Updated existing reminder: "${reminder.title}"`);
    return "updated";
  } else {
    await prisma.reminder.create({
      data: {
        userToken,
        ...reminder,
        status: "active",
      },
    });
    console.log(`✅ Created new reminder: "${reminder.title}"`);
    return "created";
  }
}

// ---------------------------------------------------------------------------
// 3. Main entry point — called from flushConversationToMemory
//    Receives raw reminders array already extracted by GPT (no GPT call here)
// ---------------------------------------------------------------------------

export async function parseAndSaveReminders(userToken, rawReminders) {
  if (!Array.isArray(rawReminders) || rawReminders.length === 0) {
    console.log("ℹ️ No reminders to save");
    return;
  }

  console.log(`⏰ Saving ${rawReminders.length} reminder(s)...`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const rawReminder of rawReminders) {
    const reminder = normalizeReminder(rawReminder);

    if (!reminder) {
      skipped++;
      console.warn("⚠️ Skipped invalid reminder (missing title):", rawReminder);
      continue;
    }

    const result = await upsertReminder(userToken, reminder);
    if (result === "created") created++;
    else if (result === "updated") updated++;
  }

  console.log(
    `⏰ Reminders done — created: ${created}, updated: ${updated}, skipped: ${skipped}`,
  );
}
