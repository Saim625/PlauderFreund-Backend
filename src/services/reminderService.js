import prisma from "../lib/db.js";
import { DateTime } from "luxon";
import { DEFAULT_REMINDER_TIMEZONE, reminderWindow } from "../utils/reminderSchedule.js";

const TITLE_NOISE_WORDS = new Set([
  "daily",
  "everyday",
  "every",
  "each",
  "täglich",
  "taeglich",
  "jeden",
  "jedes",
  "jede",
  "tag",
]);

/**
 * Creates a stable identifier from the reminder's meaning, not its display
 * wording. In particular, generated suffixes such as "daily" do not turn a
 * reminder into a separate database record.
 */
export function buildReminderIdentityKey(title, reminderType = "general") {
  const normalizedTitle = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !TITLE_NOISE_WORDS.has(word))
    .join(" ");

  return `${reminderType || "general"}:${normalizedTitle}`;
}

// ---------------------------------------------------------------------------
// 1. Validate & normalize a single raw reminder from GPT output
// ---------------------------------------------------------------------------

export function normalizeReminder(raw, timezone = DEFAULT_REMINDER_TIMEZONE) {
  if (!raw || !raw.title || typeof raw.title !== "string" || !raw.title.trim()) {
    return null;
  }

  const validTypes = ["medication", "appointment", "birthday", "general"];
  const validRecurrences = ["none", "daily", "weekly", "yearly"];

  // Require an explicit offset; never interpret AI dates in the server timezone.
  const safeDate = (val) => {
    if (typeof val !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(val)) return null;
    const date = DateTime.fromISO(val, { setZone: true });
    return date.isValid ? date.toJSDate() : null;
  };

  const reminder = {
    title: raw.title.trim(),
    description: raw.description?.trim() || null,
    reminderType: validTypes.includes(raw.reminder_type)
      ? raw.reminder_type
      : "general",
    eventDatetime: safeDate(raw.event_datetime),
    timezone,
    recurrence: validRecurrences.includes(raw.recurrence)
      ? raw.recurrence
      : "none",
    existingReminderId: Number.isInteger(raw.existing_reminder_id)
      ? raw.existing_reminder_id
      : null,
    action: ["create", "update", "none"].includes(raw.action)
      ? raw.action
      : "create",
  };

  if (!reminder.eventDatetime) return null;
  Object.assign(reminder, reminderWindow(reminder.eventDatetime, reminder.reminderType, timezone));

  return reminder;
}

// ---------------------------------------------------------------------------
// 2. Upsert — update if same title+type exists and is active, else create
// ---------------------------------------------------------------------------

async function upsertReminder(userToken, reminder) {
  const identityKey = buildReminderIdentityKey(
    reminder.title,
    reminder.reminderType,
  );

  // An explicit existing id, supplied only when the user clearly changed a
  // listed reminder, takes precedence over title matching.
  let existing = reminder.existingReminderId
    ? await prisma.reminder.findFirst({
        where: {
          id: reminder.existingReminderId,
          userToken,
          status: "active",
        },
      })
    : null;

  if (!existing) {
    existing = await prisma.reminder.findFirst({
      where: { userToken, identityKey, status: "active" },
    });
  }

  // Supports reminders created before identityKey was introduced. Once one is
  // touched, it is migrated naturally by the update below.
  if (!existing) {
    const legacyCandidates = await prisma.reminder.findMany({
      where: { userToken, reminderType: reminder.reminderType, status: "active" },
    });
    existing = legacyCandidates.find(
      (candidate) =>
        buildReminderIdentityKey(candidate.title, candidate.reminderType) ===
        identityKey,
    );
  }

  // "none" is the extractor's explicit signal that this was only a repeat or
  // acknowledgement. It must never create a record, even if GPT supplied an
  // incorrect or stale existing id.
  if (!existing && reminder.action === "none") {
    console.log(`⏭️ Non-new reminder skipped: "${reminder.title}"`);
    return "skipped";
  }

  if (existing) {
    // Repeating an already-known reminder is not an instruction to move its
    // schedule. Only an explicit user-requested change may update it.
    if (reminder.action !== "update") {
      console.log(`⏭️ Duplicate reminder skipped: "${reminder.title}"`);
      return "skipped";
    }

    const window = reminderWindow(reminder.eventDatetime, existing.reminderType, reminder.timezone);
    // Recompute both boundaries; never reuse an old or AI-generated window.
    await prisma.reminder.update({
      where: { id: existing.id },
      data: {
        description: reminder.description ?? existing.description,
        eventDatetime: reminder.eventDatetime ?? existing.eventDatetime,
        ...window,
        timezone: reminder.timezone,
        recurrence: reminder.recurrence ?? existing.recurrence,
        identityKey: buildReminderIdentityKey(existing.title, existing.reminderType),
        updatedAt: new Date(),
      },
    });
    console.log(`🔄 Updated existing reminder: "${reminder.title}"`);
    return "updated";
  } else {
    try {
      await prisma.reminder.create({
        data: {
          userToken,
          title: reminder.title,
          description: reminder.description,
          reminderType: reminder.reminderType,
          eventDatetime: reminder.eventDatetime,
          remindFrom: reminder.remindFrom,
          remindUntil: reminder.remindUntil,
          recurrence: reminder.recurrence,
          timezone: reminder.timezone,
          identityKey,
          status: "active",
        },
      });
      console.log(`✅ Created new reminder: "${reminder.title}"`);
      return "created";
    } catch (err) {
      // The unique key also protects against two concurrent conversation
      // flushes attempting to create the same reminder.
      if (err.code !== "P2002") throw err;

      const concurrentExisting = await prisma.reminder.findFirst({
        where: { userToken, identityKey, status: "active" },
      });
      if (!concurrentExisting) throw err;

      await prisma.reminder.update({
        where: { id: concurrentExisting.id },
        data: { updatedAt: new Date() },
      });
      console.log(`🔄 Reused concurrently-created reminder: "${reminder.title}"`);
      return "updated";
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Main entry point — called from flushConversationToMemory
//    Receives raw reminders array already extracted by GPT (no GPT call here)
// ---------------------------------------------------------------------------

export async function parseAndSaveReminders(userToken, rawReminders, timezone = DEFAULT_REMINDER_TIMEZONE) {
  if (!Array.isArray(rawReminders) || rawReminders.length === 0) {
    console.log("ℹ️ No reminders to save");
    return;
  }

  console.log(`⏰ Saving ${rawReminders.length} reminder(s)...`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const rawReminder of rawReminders) {
    const reminder = normalizeReminder(rawReminder, timezone);

    if (!reminder) {
      skipped++;
      console.warn("⚠️ Skipped invalid reminder (missing title or valid event time):", rawReminder);
      continue;
    }

    const result = await upsertReminder(userToken, reminder);
    if (result === "created") created++;
    else if (result === "updated") updated++;
    else if (result === "skipped") skipped++;
  }

  console.log(
    `⏰ Reminders done — created: ${created}, updated: ${updated}, skipped: ${skipped}`,
  );
}
