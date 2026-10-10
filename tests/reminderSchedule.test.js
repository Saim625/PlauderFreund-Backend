import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { reminderWindow, isReminderDue, reminderDeliveryDate, reminderTimeContext } from '../src/utils/reminderSchedule.js';
import { reschedule } from '../src/utils/rescheduleReminder.js';
import { normalizeReminder } from '../src/services/reminderService.js';

const date = (s) => new Date(s);
const event = date('2026-10-02T20:00:00+02:00');

test('backend overrides incorrect AI medication window', () => {
  const r = normalizeReminder({title:'Spritze', reminder_type:'medication', event_datetime:event.toISOString(), recurrence:'weekly', remind_from:'2026-10-01T18:00:00Z', remind_until:'2026-12-01T00:00:00Z'});
  assert.equal(r.remindFrom.toISOString(), '2026-10-02T17:00:00.000Z');
  assert.equal(r.remindUntil.toISOString(), '2026-10-02T20:00:00.000Z');
});

test('all categories require an event time and an explicit offset', () => {
  for (const reminder_type of ['medication','appointment','birthday','general']) {
    for (const event_datetime of [null, '', 'nonsense', '2026-10-02T20:00:00', '2026-02-30T20:00:00Z']) {
      assert.equal(normalizeReminder({title:'Watch', reminder_type, event_datetime}), null);
    }
  }
});

test('all four category windows are deterministic', () => {
  for (const [type,hours] of [['medication',1],['appointment',24],['birthday',48],['general',2]]) {
    const w = reminderWindow(event,type);
    assert.equal(event - w.remindFrom, hours * 3600000);
    assert.equal(w.remindUntil.toISOString(), type === 'birthday' ? '2026-10-02T21:59:59.999Z' : '2026-10-02T20:00:00.000Z');
  }
});

test('window boundaries are inclusive; null dates are never due', () => {
  const r = {status:'active',eventDatetime:event,...reminderWindow(event,'medication')};
  assert.equal(isReminderDue(r,new Date(+r.remindFrom-1)), false);
  assert.equal(isReminderDue(r,r.remindFrom), true);
  assert.equal(isReminderDue(r,r.remindUntil), true);
  assert.equal(isReminderDue(r,new Date(+r.remindUntil+1)), false);
  assert.equal(isReminderDue({...r,remindFrom:null}), false);
  assert.equal(isReminderDue({...r,eventDatetime:null}), false);
});

test('weekly Berlin schedule stays at six across winter clock change', () => {
  const r = {eventDatetime:date('2026-10-23T06:00:00+02:00'),reminderType:'medication',recurrence:'weekly',timezone:'Europe/Berlin'};
  const next = reschedule(r,date('2026-10-23T17:00:00Z'));
  assert.equal(next.newEventDatetime.toISOString(),'2026-10-30T05:00:00.000Z');
  assert.equal(next.newRemindFrom.toISOString(),'2026-10-30T04:00:00.000Z');
});

test('daily Berlin schedule stays at six across summer clock change', () => {
  const next = reschedule({eventDatetime:date('2026-03-28T06:00:00+01:00'),reminderType:'medication',recurrence:'daily',timezone:'Europe/Berlin'}, date('2026-03-28T18:00:00Z'));
  assert.equal(next.newEventDatetime.toISOString(),'2026-03-29T04:00:00.000Z');
});

test('catch-up skips closed windows but keeps an occurrence still in its after-event window', () => {
  const next = reschedule({eventDatetime:date('2026-09-01T06:30:00+02:00'),reminderType:'medication',recurrence:'daily',timezone:'Europe/Berlin'},date('2026-10-03T05:00:00Z'));
  assert.equal(next.newEventDatetime.toISOString(),'2026-10-03T04:30:00.000Z');
});

test('web timezone and end of day are independent of server timezone', () => {
  const w = reminderWindow(event,'birthday','Asia/Karachi');
  assert.equal(w.remindUntil.toISOString(),'2026-10-02T18:59:59.999Z');
  const n = reschedule({eventDatetime:event,reminderType:'general',recurrence:'yearly',timezone:'Asia/Karachi'},date('2026-10-04T00:00:00Z'));
  assert.equal(DateTime.fromJSDate(n.newEventDatetime,{zone:'Asia/Karachi'}).hour,23);
});

test('relative wording and daily keys use the reminder timezone at local midnight', () => {
  const r = {eventDatetime:date('2026-10-11T11:00:00+05:00'),timezone:'Asia/Karachi'};
  assert.match(reminderTimeContext(r,date('2026-10-10T18:59:00Z')), /^tomorrow at 11:00/);
  assert.match(reminderTimeContext(r,date('2026-10-10T19:00:00Z')), /^today at 11:00/);
  assert.equal(reminderDeliveryDate(r,date('2026-10-10T19:00:00Z')), '2026-10-11');
  assert.match(reminderTimeContext(r,date('2026-10-11T07:00:00Z')), /already passed/);
});
