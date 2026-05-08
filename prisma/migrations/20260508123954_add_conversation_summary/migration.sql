-- CreateTable
CREATE TABLE "conversation_summaries" (
    "id" SERIAL NOT NULL,
    "user_token" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "session_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_user_token_fkey" FOREIGN KEY ("user_token") REFERENCES "UserAccessToken"("token") ON DELETE RESTRICT ON UPDATE CASCADE;
