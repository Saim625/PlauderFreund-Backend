import { DateTime } from "luxon";
import { DEFAULT_REMINDER_TIMEZONE, reminderWindow } from "./reminderSchedule.js";

// Advance after the window closes, including occurrences missed during downtime.
export function reschedule(reminder, now = new Date()) {
  const unit = { daily: "days", weekly: "weeks", yearly: "years" }[reminder.recurrence];
  if (!unit || !reminder.eventDatetime) return null;
  const timezone = reminder.timezone || DEFAULT_REMINDER_TIMEZONE;
  const original = DateTime.fromJSDate(reminder.eventDatetime, { zone: timezone });
  if (!original.isValid) return null;

  const current = DateTime.fromJSDate(now, { zone: timezone });
  let count = Math.max(1, Math.floor(current.diff(original, unit).get(unit)) - 1);
  let eventDatetime, window;
  do {
    eventDatetime = original.plus({ [unit]: count++ }).toJSDate();
    window = reminderWindow(eventDatetime, reminder.reminderType, timezone);
  } while (window.remindUntil < now);

  return {
    newEventDatetime: eventDatetime,
    newRemindFrom: window.remindFrom,
    newRemindUntil: window.remindUntil,
  };
}
