# Reminder windows and daily delivery

The backend owns windows; AI-provided window fields are ignored.

| Type | Starts before event | Ends |
| --- | --- | --- |
| Medication | 1 hour | 2 hours after event |
| Appointment | 24 hours | 2 hours after event |
| General | 2 hours | 2 hours after event |
| Birthday | 48 hours | End of event's local day |

Automatic delivery requires three distinct, nonempty user transcriptions in the
current session. The scheduler only queues due reminders. It cannot bypass this
rule or start a reminder-only response. Context is prepared while no response is
active, for the next normal response (the third response or later, depending on
transcription/response timing). The AI is instructed to start with a brief answer,
mention one reminder early within the response, then continue answering, using its local date and time and accurate
“today” / “tomorrow” wording. Explicit requests to list reminders remain allowed.

Delivery is one attempt per `(reminderId, local calendar date)`, across sessions
and backend workers, protected by a PostgreSQL unique index and transaction.
The date uses the reminder's stored timezone, not the server timezone.
An appointment tomorrow can be mentioned once today and once tomorrow while
its window is open. Acknowledgement is optional and does not enable another
announcement that day. Editing a reminder's time does not reset its daily limit.

The claim is recorded before sending context to the realtime AI. If the call
ends before the next response, sending fails, or playback is interrupted, the
attempt is not retried that day. This is at-most-once context injection, not proof
the user heard the announcement. Model wording still requires live-call checks.
Duplicate database reminders with different IDs are separate reminders.

For missed-delivery diagnosis, `REMINDER_CHECK` records due IDs, queued IDs,
the distinct user message count, and IDs already attempted that day.
`REMINDER_DEFERRED` explains the delivery gate. `REMINDER_RESPONSE_STARTED` and
`REMINDER_RESPONSE_FINISHED` track the response associated with reminder context;
these events do not confirm audible playback.

After the entire window closes, cleanup advances daily/weekly/yearly reminders
to the first occurrence whose window has not closed. It preserves local clock
time using the stored IANA timezone. Cleanup runs every five minutes and at
startup, even without a connected user. It does not advance the event immediately
after delivery or at midnight. One-time reminders become completed if attempted,
or expired if never attempted. Delivery only happens during active conversations.

The existing event-time save path is unchanged: validated offset-qualified ISO
values go to Prisma without an added manual hour adjustment.

## Deploy

Stop old backend workers before migrating; all workers must use the daily guard.
Install dependencies, apply migrations, generate the client, then restart:

```sh
npm ci
npx prisma migrate deploy
npx prisma generate
```

Migration `20261010000000_daily_reminder_delivery` repairs windows on active,
dated reminders without changing their event times. It backfills daily keys from
historical delivered/acknowledged logs using the currently stored timezone;
duplicate logs are preserved. Completed reminders are not reopened. Legacy rows
whose timezone was defaulted to Europe/Berlin by the earlier occurrence migration
still need review if they were actually created in another timezone.

## Verify

`npm test` runs schedule tests and skips DB tests unless an explicit disposable
`REMINDER_TEST_DATABASE_URL` is supplied. Integration tests create their own user
and remove that user's records afterward. Never point them at production.

```sh
REMINDER_TEST_DATABASE_URL='postgresql://USER@HOST:PORT/TEST_DB' npm test
psql 'postgresql://USER@HOST:PORT/TEST_DB' -f tests/reminderMigration.sql
psql 'postgresql://USER@HOST:PORT/TEST_DB' -f tests/reminderDailyMigration.sql
```

Migration fixtures use isolated schemas inside rolled-back transactions.
