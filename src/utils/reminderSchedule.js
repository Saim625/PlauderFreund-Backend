import { DateTime } from "luxon";

export const DEFAULT_REMINDER_TIMEZONE = "Europe/Berlin";

export function reminderWindow(eventDatetime, reminderType, timezone = DEFAULT_REMINDER_TIMEZONE) {
  if (!(eventDatetime instanceof Date) || !Number.isFinite(eventDatetime.getTime())) {
    throw new Error("A valid reminder event time is required");
  }
  const event = DateTime.fromJSDate(eventDatetime, { zone: timezone });
  if (!event.isValid) throw new Error("Invalid reminder timezone");
  const hoursBefore = { medication: 1, appointment: 24, birthday: 48, general: 2 }[reminderType] ?? 2;
  return {
    remindFrom: event.minus({ hours: hoursBefore }).toJSDate(),
    remindUntil: (reminderType === "birthday" ? event.endOf("day") : event.plus({ hours: 2 })).toJSDate(),
  };
}

export function isReminderDue(reminder, now = new Date()) {
  return reminder.status === "active" && reminder.eventDatetime instanceof Date &&
    reminder.remindFrom instanceof Date && reminder.remindUntil instanceof Date &&
    reminder.remindFrom <= now && reminder.remindUntil >= now;
}

// Calendar date in the reminder's timezone, not the server's or the caller's.
export function reminderDeliveryDate(reminder, now = new Date()) {
  return DateTime.fromJSDate(now, { zone: reminder.timezone || DEFAULT_REMINDER_TIMEZONE }).toISODate();
}

export function reminderTimeContext(reminder, now = new Date()) {
  const zone = reminder.timezone || DEFAULT_REMINDER_TIMEZONE;
  const event = DateTime.fromJSDate(reminder.eventDatetime, { zone });
  const today = DateTime.fromJSDate(now, { zone }).startOf("day");
  const days = Math.round(event.startOf("day").diff(today, "days").days);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : event.toISODate();
  return `${day} at ${event.toFormat("HH:mm")} (${event.toISODate()}, ${zone})${event.toMillis() < now.getTime() ? "; the scheduled time has already passed" : ""}`;
}
