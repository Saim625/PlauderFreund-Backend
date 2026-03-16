// utils/rescheduleReminder.js

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

export function reschedule(reminder) {
  const { recurrence, eventDatetime, remindFrom, remindUntil } = reminder;

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
    return null; // recurrence = 'none'
  }

  return { newEventDatetime, newRemindFrom, newRemindUntil };
}
