\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA reminder_daily_migration_test;
SET LOCAL search_path TO reminder_daily_migration_test;
CREATE TABLE reminders (
 id INTEGER PRIMARY KEY, event_datetime TIMESTAMPTZ, reminder_type TEXT,
 remind_from TIMESTAMPTZ, remind_until TIMESTAMPTZ, status TEXT, timezone TEXT
);
CREATE TABLE reminder_delivery_log (
 id INTEGER PRIMARY KEY, reminder_id INTEGER, delivered_at TIMESTAMPTZ,
 delivery_status TEXT, occurrence_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX reminder_delivery_log_reminder_id_occurrence_at_key
 ON reminder_delivery_log(reminder_id, occurrence_at);
INSERT INTO reminders VALUES
 (1,'2026-10-11 04:00+05','medication',NULL,NULL,'active','Asia/Karachi'),
 (2,'2026-10-11 11:00+02','appointment',NULL,NULL,'active','Europe/Berlin'),
 (3,'2026-10-11 20:00+05','general',NULL,NULL,'active','Asia/Karachi'),
 (4,'2026-10-11 00:00+02','birthday',NULL,NULL,'active','Europe/Berlin');
INSERT INTO reminder_delivery_log VALUES
 (1,1,'2026-10-10 23:30Z','delivered',NULL),
 (2,1,'2026-10-11 00:00Z','acknowledged',NULL),
 (3,1,'2026-10-11 20:00Z','delivered',NULL);
\ir ../prisma/migrations/20261010000000_daily_reminder_delivery/migration.sql
DO $$
BEGIN
 IF (SELECT count(*) FROM reminder_delivery_log) <> 3 OR
    (SELECT count(*) FROM reminder_delivery_log WHERE delivery_date='2026-10-11') <> 1 OR
    (SELECT count(*) FROM reminder_delivery_log WHERE delivery_date='2026-10-12') <> 1 THEN
  RAISE EXCEPTION 'Local daily keys or historical duplicate preservation failed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM reminders WHERE id=1 AND remind_from='2026-10-10 22:00Z' AND remind_until='2026-10-11 01:00Z') OR
    NOT EXISTS (SELECT 1 FROM reminders WHERE id=2 AND remind_from='2026-10-10 09:00Z' AND remind_until='2026-10-11 11:00Z') OR
    NOT EXISTS (SELECT 1 FROM reminders WHERE id=3 AND remind_from='2026-10-11 13:00Z' AND remind_until='2026-10-11 17:00Z') OR
    NOT EXISTS (SELECT 1 FROM reminders WHERE id=4 AND remind_from='2026-10-08 22:00Z' AND remind_until='2026-10-11 21:59:59.999Z') THEN
  RAISE EXCEPTION 'Window repair failed';
 END IF;
 BEGIN
  INSERT INTO reminder_delivery_log VALUES (4,1,now(),'delivered',NULL,'2026-10-11');
  RAISE EXCEPTION 'Daily uniqueness was not enforced';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
ROLLBACK;
