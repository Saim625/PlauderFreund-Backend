ALTER TABLE "reminders" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin';
ALTER TABLE "reminder_delivery_log" ADD COLUMN "occurrence_at" TIMESTAMPTZ;

-- Older rows did not store a timezone; use the telephony product default.
-- Preserve evidence of an already delivered current occurrence before repairing
-- its window. Keep duplicate historical logs, but attach only one to the key.
WITH current_deliveries AS (
  SELECT l.id, r.event_datetime,
         ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY l.delivered_at, l.id) AS position
  FROM reminder_delivery_log l
  JOIN reminders r ON r.id = l.reminder_id
  WHERE r.event_datetime IS NOT NULL
    AND l.delivery_status IN ('delivered', 'acknowledged')
    AND l.delivered_at >= COALESCE(r.remind_from, r.event_datetime - INTERVAL '48 hours')
    AND l.delivered_at <= COALESCE(r.remind_until, r.event_datetime + INTERVAL '24 hours')
)
UPDATE reminder_delivery_log l
SET occurrence_at = d.event_datetime
FROM current_deliveries d
WHERE l.id = d.id AND d.position = 1;

CREATE UNIQUE INDEX "reminder_delivery_log_reminder_id_occurrence_at_key"
ON "reminder_delivery_log"("reminder_id", "occurrence_at");

-- Repair AI-generated windows for existing scheduled reminders too.
UPDATE reminders
SET remind_from = event_datetime - CASE
      WHEN reminder_type = 'medication' THEN INTERVAL '1 hour'
      WHEN reminder_type = 'birthday' THEN INTERVAL '48 hours'
      ELSE INTERVAL '24 hours' END,
    remind_until = CASE
      WHEN reminder_type = 'medication' THEN event_datetime + INTERVAL '12 hours'
      ELSE (((event_datetime AT TIME ZONE timezone)::date + INTERVAL '1 day')
        AT TIME ZONE timezone) - INTERVAL '1 millisecond' END
WHERE event_datetime IS NOT NULL AND status = 'active';
