import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Set an explicit disposable database URL; never use the application's .env DB.
test('reminder occurrence integration tests', { skip: !process.env.REMINDER_TEST_DATABASE_URL }, async (t) => {
  process.env.DATABASE_URL = process.env.REMINDER_TEST_DATABASE_URL;
  const { default: db } = await import('../src/lib/db.js');
  const { reminderWindow } = await import('../src/utils/reminderSchedule.js');
  const { claimReminderOccurrence, enqueueDueRemindersForSession, markReminderResponseStarted, markReminderSlotFreeForNextResponse, clearReminderSession } = await import('../src/services/reminderQueue.js');
  const { cleanupReminderOccurrences } = await import('../src/services/reminderScheduler.js');
  const { parseAndSaveReminders } = await import('../src/services/reminderService.js');
  const { handleToolCall } = await import('../src/utils/toolHandlers.js');
  const token = `reminder-test-${randomUUID()}`;
  const now = new Date();
  await db.userAccessToken.create({data:{token}});
  const make = (overrides = {}) => db.reminder.create({data:{userToken:token,title:'Spritze',reminderType:'medication',recurrence:'weekly',timezone:'Europe/Berlin',eventDatetime:now,...reminderWindow(now,'medication'),...overrides}});
  const ws = () => ({readyState:1, sent:[], send(s){this.sent.push(JSON.parse(s));}});
  try {
    await t.test('concurrent calls claim exactly once, and reconnect cannot claim again', async () => {
      const r = await make();
      const claims = await Promise.all(Array.from({length:12},(_,i)=>claimReminderOccurrence(r.id,r.eventDatetime,token,`session-${i}`,db,now)));
      assert.equal(claims.filter(Boolean).length,1);
      assert.equal(await db.reminderDeliveryLog.count({where:{reminderId:r.id}}),1);
      assert.equal((await db.reminder.findUnique({where:{id:r.id}})).timesReminded,1);
      assert.equal(await claimReminderOccurrence(r.id,r.eventDatetime,token,'reconnect',db,now),null);
      assert.equal(await claimReminderOccurrence(r.id,r.eventDatetime,'different-user','other',db,now),null);
    });
    await t.test('stale queued dates and closed/null windows never deliver', async () => {
      const r = await make();
      assert.equal(await claimReminderOccurrence(r.id,new Date(+now-1000),token,'stale',db,now),null);
      assert.equal(await claimReminderOccurrence(r.id,r.eventDatetime,token,'too-early',db,new Date(+r.remindFrom-1)),null);
      assert.equal(await claimReminderOccurrence(r.id,r.eventDatetime,token,'too-late',db,new Date(+r.remindUntil+1)),null);
      await db.reminder.update({where:{id:r.id},data:{remindFrom:null,remindUntil:null}});
      assert.equal(await claimReminderOccurrence(r.id,r.eventDatetime,token,'null',db,now),null);
    });
    await t.test('one-time delivery completes reminder; acknowledgement remains possible', async () => {
      const r = await make({recurrence:'none'});
      assert.ok(await claimReminderOccurrence(r.id,r.eventDatetime,token,'once',db,now));
      assert.equal((await db.reminder.findUnique({where:{id:r.id}})).status,'completed');
      const socket = ws();
      await handleToolCall({name:'acknowledge_reminder',call_id:'ack',arguments:JSON.stringify({reminder_id:r.id})},'once',token,socket);
      const log = await db.reminderDeliveryLog.findFirst({where:{reminderId:r.id}});
      assert.equal(log.deliveryStatus,'acknowledged');
      assert.equal(await claimReminderOccurrence(r.id,r.eventDatetime,token,'next-session',db,now),null);
    });
    await t.test('do not reschedule an evening dose at midnight while its window is open', async () => {
      const eventDatetime = new Date('2026-10-02T20:00:00+02:00');
      const r = await make({eventDatetime,...reminderWindow(eventDatetime,'medication'),recurrence:'daily'});
      await cleanupReminderOccurrences(db,new Date('2026-10-03T00:00:00+02:00'));
      assert.equal(+(await db.reminder.findUnique({where:{id:r.id}})).eventDatetime,+eventDatetime);
      await cleanupReminderOccurrences(db,new Date('2026-10-03T09:00:00+02:00'));
      const next = await db.reminder.findUnique({where:{id:r.id}});
      assert.equal(next.eventDatetime.toISOString(),'2026-10-03T18:00:00.000Z');
      assert.equal(next.remindFrom.toISOString(),'2026-10-03T17:00:00.000Z');
    });
    await t.test('next occurrence delivers once; old acknowledgement does not acknowledge it', async () => {
      const r = await make();
      await claimReminderOccurrence(r.id,r.eventDatetime,token,'original',db,now);
      await cleanupReminderOccurrences(db,new Date(+r.remindUntil+1));
      const next = await db.reminder.findUnique({where:{id:r.id}});
      assert.ok(+next.eventDatetime > +r.eventDatetime);
      await handleToolCall({name:'acknowledge_reminder',call_id:'late-ack',arguments:JSON.stringify({reminder_id:r.id})},'original',token,ws());
      assert.equal((await db.reminder.findUnique({where:{id:r.id}})).acknowledgedAt,null);
      assert.ok(await claimReminderOccurrence(r.id,next.eventDatetime,token,'next-week',db,next.remindFrom));
      assert.equal(await claimReminderOccurrence(r.id,next.eventDatetime,token,'next-week-again',db,next.remindFrom),null);
    });
    await t.test('save and update always overwrite AI windows using the stored medication category', async () => {
      const input = {title:'Unique injection',reminder_type:'medication',recurrence:'weekly',event_datetime:'2026-10-09T06:30:00+02:00',remind_from:'2026-10-08T04:30:00Z',action:'create'};
      await parseAndSaveReminders(token,[input],'Europe/Berlin');
      let r = await db.reminder.findFirst({where:{userToken:token,title:input.title}});
      assert.equal(r.remindFrom.toISOString(),'2026-10-09T03:30:00.000Z');
      await parseAndSaveReminders(token,[{...input,existing_reminder_id:r.id,action:'update',reminder_type:'general',event_datetime:'2026-10-09T07:30:00+02:00'}],'Europe/Berlin');
      r = await db.reminder.findUnique({where:{id:r.id}});
      assert.equal(r.remindFrom.toISOString(),'2026-10-09T04:30:00.000Z');
      assert.equal(r.remindUntil.toISOString(),'2026-10-09T17:30:00.000Z');
    });
    await t.test('same-session concurrent checks inject once and remove context only after a consuming response', async () => {
      // Other test rows are no longer candidates in this isolated user session.
      await db.reminder.updateMany({where:{userToken:token},data:{status:'expired'}});
      const r = await make();
      const socket = ws();
      await Promise.all([enqueueDueRemindersForSession(token,'queue',socket),enqueueDueRemindersForSession(token,'queue',socket)]);
      assert.equal(socket.sent.filter(x=>x.type==='conversation.item.create').length,1);
      markReminderSlotFreeForNextResponse('queue',socket);
      assert.equal(socket.sent.filter(x=>x.type==='conversation.item.delete').length,0);
      markReminderResponseStarted('queue');
      markReminderSlotFreeForNextResponse('queue',socket);
      assert.equal(socket.sent.filter(x=>x.type==='conversation.item.delete').length,1);
      await enqueueDueRemindersForSession(token,'new-call',socket);
      assert.equal(socket.sent.filter(x=>x.type==='conversation.item.create').length,2);
      assert.equal(await db.reminderDeliveryLog.count({where:{reminderId:r.id}}),1);
      clearReminderSession('queue'); clearReminderSession('new-call');
    });
  } finally {
    await db.reminder.deleteMany({where:{userToken:token}});
    await db.userAccessToken.delete({where:{token}});
    await db.$disconnect();
  }
});
