-- CreateTable
CREATE TABLE "greeting_history" (
    "id" SERIAL NOT NULL,
    "user_token" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "greeting_history_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "greeting_history" ADD CONSTRAINT "greeting_history_user_token_fkey" FOREIGN KEY ("user_token") REFERENCES "UserAccessToken"("token") ON DELETE RESTRICT ON UPDATE CASCADE;
