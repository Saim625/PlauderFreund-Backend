import { DateTime } from "luxon";

export const DEFAULT_REMINDER_TIMEZONE = "Europe/Berlin";

export function reminderWindow(eventDatetime, reminderType, timezone = DEFAULT_REMINDER_TIMEZONE) {
  if (!(eventDatetime instanceof Date) || !Number.isFinite(eventDatetime.getTime())) {
    throw new Error("A valid reminder event time is required");
  }
  const event = DateTime.fromJSDate(eventDatetime, { zone: timezone });
  if (!event.isValid) throw new Error("Invalid reminder timezone");
  const hoursBefore = reminderType === "medication" ? 1 : reminderType === "birthday" ? 48 : 24;
  return {
    remindFrom: event.minus({ hours: hoursBefore }).toJSDate(),
    remindUntil: (reminderType === "medication" ? event.plus({ hours: 12 }) : event.endOf("day")).toJSDate(),
  };
}

export function isReminderDue(reminder, now = new Date()) {
  return reminder.status === "active" && reminder.eventDatetime instanceof Date &&
    reminder.remindFrom instanceof Date && reminder.remindUntil instanceof Date &&
    reminder.remindFrom <= now && reminder.remindUntil >= now;
}
