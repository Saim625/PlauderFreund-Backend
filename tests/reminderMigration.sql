\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA reminder_migration_test;
SET LOCAL search_path TO reminder_migration_test;
CREATE TABLE reminders (
 id INTEGER PRIMARY KEY, event_datetime TIMESTAMPTZ, reminder_type TEXT,
 remind_from TIMESTAMPTZ, remind_until TIMESTAMPTZ, status TEXT
);
CREATE TABLE reminder_delivery_log (
 id INTEGER PRIMARY KEY, reminder_id INTEGER, delivered_at TIMESTAMPTZ,
 delivery_status TEXT
);
INSERT INTO reminders VALUES
 (1, '2026-10-02 20:00+02', 'medication', '2026-10-01 20:00+02', '2026-10-03 08:00+02', 'active'),
 (2, '2026-10-02 10:00+02', 'appointment', NULL, NULL, 'active'),
 (3, NULL, 'general', NULL, NULL, 'active');
INSERT INTO reminder_delivery_log VALUES
 (1, 1, '2026-10-01 21:00+02', 'delivered'),
 (2, 1, '2026-10-02 19:30+02', 'acknowledged');
\ir ../prisma/migrations/20261003000000_strict_reminder_occurrences/migration.sql
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM reminders WHERE id=1 AND remind_from='2026-10-02 17:00Z' AND remind_until='2026-10-03 06:00Z') THEN
  RAISE EXCEPTION 'Medication window was not repaired';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM reminders WHERE id=2 AND remind_until='2026-10-02 21:59:59.999Z') THEN
  RAISE EXCEPTION 'Berlin end of day was not calculated';
 END IF;
 IF (SELECT COUNT(*) FROM reminder_delivery_log WHERE occurrence_at='2026-10-02 18:00Z') <> 1 THEN
  RAISE EXCEPTION 'Current occurrence was not backfilled exactly once';
 END IF;
 IF (SELECT COUNT(*) FROM reminder_delivery_log) <> 2 THEN
  RAISE EXCEPTION 'Historical logs were lost';
 END IF;
 BEGIN
  INSERT INTO reminder_delivery_log VALUES (3,1,now(),'delivered','2026-10-02 18:00Z');
  RAISE EXCEPTION 'Unique occurrence constraint was not enforced';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END $$;
ROLLBACK;
