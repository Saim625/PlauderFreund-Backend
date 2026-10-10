ALTER TABLE reminder_delivery_log ADD COLUMN delivery_date VARCHAR(10);
DROP INDEX "reminder_delivery_log_reminder_id_occurrence_at_key";
-- Keep historical duplicates intact; one log guards each local delivery day.
WITH dated AS (
  SELECT l.id, to_char(l.delivered_at AT TIME ZONE r.timezone, 'YYYY-MM-DD') AS day,
         row_number() OVER (PARTITION BY l.reminder_id,
           (l.delivered_at AT TIME ZONE r.timezone)::date ORDER BY l.delivered_at, l.id) AS position
  FROM reminder_delivery_log l JOIN reminders r ON r.id = l.reminder_id
  WHERE l.delivery_status IN ('delivered', 'acknowledged')
)
UPDATE reminder_delivery_log l SET delivery_date = d.day
FROM dated d WHERE l.id = d.id AND d.position = 1;
CREATE UNIQUE INDEX "reminder_delivery_log_reminder_id_delivery_date_key"
ON reminder_delivery_log(reminder_id, delivery_date);

UPDATE reminders
SET remind_from = event_datetime - CASE reminder_type
      WHEN 'medication' THEN INTERVAL '1 hour'
      WHEN 'appointment' THEN INTERVAL '24 hours'
      WHEN 'birthday' THEN INTERVAL '48 hours'
      ELSE INTERVAL '2 hours' END,
    remind_until = CASE WHEN reminder_type = 'birthday'
      THEN (((event_datetime AT TIME ZONE timezone)::date + INTERVAL '1 day')
        AT TIME ZONE timezone) - INTERVAL '1 millisecond'
      ELSE event_datetime + INTERVAL '2 hours' END
WHERE event_datetime IS NOT NULL AND status = 'active';
