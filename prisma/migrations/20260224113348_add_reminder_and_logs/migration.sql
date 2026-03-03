-- CreateTable
CREATE TABLE "reminders" (
    "id" SERIAL NOT NULL,
    "user_token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reminder_type" VARCHAR(50),
    "event_datetime" TIMESTAMPTZ,
    "remind_from" TIMESTAMPTZ,
    "remind_until" TIMESTAMPTZ,
    "recurrence" VARCHAR(50) NOT NULL DEFAULT 'none',
    "status" VARCHAR(30) NOT NULL DEFAULT 'active',
    "acknowledged_at" TIMESTAMPTZ,
    "times_reminded" INTEGER NOT NULL DEFAULT 0,
    "max_reminders_per_session" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_delivery_log" (
    "id" SERIAL NOT NULL,
    "reminder_id" INTEGER NOT NULL,
    "user_token" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "delivered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_status" VARCHAR(30),
    "acknowledged_at" TIMESTAMPTZ,

    CONSTRAINT "reminder_delivery_log_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_token_fkey" FOREIGN KEY ("user_token") REFERENCES "UserAccessToken"("token") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_delivery_log" ADD CONSTRAINT "reminder_delivery_log_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
