-- A nullable column keeps existing reminders valid. PostgreSQL permits multiple
-- NULL values in a unique constraint; new/updated reminders receive a key.
ALTER TABLE "reminders" ADD COLUMN "identity_key" TEXT;

CREATE UNIQUE INDEX "reminders_user_token_identity_key_key"
ON "reminders"("user_token", "identity_key");
