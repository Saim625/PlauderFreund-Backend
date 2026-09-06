-- Store phone numbers separately so each token can have many numbers while a
-- number remains globally unique and can identify exactly one caller.
CREATE TABLE "user_phone_numbers" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "user_access_token_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_phone_numbers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_phone_numbers_number_key"
ON "user_phone_numbers"("number");

ALTER TABLE "user_phone_numbers"
ADD CONSTRAINT "user_phone_numbers_user_access_token_id_fkey"
FOREIGN KEY ("user_access_token_id") REFERENCES "UserAccessToken"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve every current single number before removing the legacy column.
INSERT INTO "user_phone_numbers" ("number", "user_access_token_id")
SELECT "number", "id"
FROM "UserAccessToken"
WHERE "number" IS NOT NULL;

ALTER TABLE "UserAccessToken" DROP COLUMN "number";
