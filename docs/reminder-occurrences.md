# Reminder windows and occurrence delivery

The backend owns delivery windows. Medication: 1 hour before through 12 hours
following the event. Appointment/general: 24 hours before through the event's
local end of day. Birthday: 48 hours before through local end of day.
AI window fields are ignored. New reminders without a valid, offset-qualified
ISO event time are rejected; existing undated reminders are not eligible.

Delivery is one attempt per `(reminderId, eventDatetime)`, across all sessions
and backend workers, protected by a PostgreSQL unique index and transaction.
The claim is recorded before sending context to the realtime AI. If the socket
fails or playback is interrupted, it is not retried. This is at-most-once
injection, not proof the user heard the announcement. Duplicate database
reminders with different IDs still need separate review.

One-time reminders become completed on delivery. Recurring reminders stay on
that occurrence until its entire window closes, then advance to the first
non-expired occurrence. Cleanup runs every five minutes and on startup, even
without a connected user. It preserves local clock time using the stored
IANA timezone. Acknowledgement records the delivered occurrence and does not
reschedule or suppress a later occurrence. Delivery still happens only during
active conversations, not via an offline alarm or outgoing call.

## Deploy

Stop the old backend workers before migrating; older code does not participate
in the occurrence guard. Install dependencies, apply migrations, generate the
client, then restart all workers:

```sh
npm ci
npx prisma migrate deploy
npx prisma generate
```

Migration `20261003000000_strict_reminder_occurrences` repairs windows on active,
dated rows using their stored category. Existing rows have no recorded timezone,
so they default to Europe/Berlin (the telephony default). Review legacy web
reminders created in other timezones before deployment. New saves/updates store
the actual session timezone.

Historical logs matching the current stored window are attached to the current
occurrence (only one gets the unique key; historical duplicates are preserved).
Older logs do not record event times, so historical occurrence attribution is
best-effort. The migration cannot infer a misclassified reminder's true category.

## Verify

`npm test` runs schedule tests and skips DB tests unless an explicit disposable
`REMINDER_TEST_DATABASE_URL` is supplied. Integration tests create their own user
and remove that user's records afterward. Never point them at production.

```sh
REMINDER_TEST_DATABASE_URL='postgresql://USER@HOST:PORT/TEST_DB' npm test
psql 'postgresql://USER@HOST:PORT/TEST_DB' -f tests/reminderMigration.sql
```

The migration test uses a temporary schema in a rolled-back transaction.
