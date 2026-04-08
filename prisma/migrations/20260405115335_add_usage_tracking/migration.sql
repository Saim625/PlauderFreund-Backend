-- CreateTable
CREATE TABLE "session_logs" (
    "id" SERIAL NOT NULL,
    "user_token" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "realtime_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "realtime_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "chat_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "chat_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "realtime_audio_chars" INTEGER NOT NULL DEFAULT 0,
    "greeting_audio_chars" INTEGER NOT NULL DEFAULT 0,
    "realtime_gpt_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chat_gpt_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elevenlabs_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_usage_summary" (
    "id" SERIAL NOT NULL,
    "user_token" TEXT NOT NULL,
    "total_sessions" INTEGER NOT NULL DEFAULT 0,
    "total_duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "total_realtime_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_realtime_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_chat_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_chat_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_realtime_audio_chars" INTEGER NOT NULL DEFAULT 0,
    "total_greeting_audio_chars" INTEGER NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_usage_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_pricing" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "price_type" TEXT NOT NULL,
    "price_per_unit" DOUBLE PRECISION NOT NULL,
    "unit_size" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_costs" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "month" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_logs_session_id_key" ON "session_logs"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_usage_summary_user_token_key" ON "user_usage_summary"("user_token");

-- CreateIndex
CREATE UNIQUE INDEX "provider_pricing_provider_price_type_key" ON "provider_pricing"("provider", "price_type");

-- AddForeignKey
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_user_token_fkey" FOREIGN KEY ("user_token") REFERENCES "UserAccessToken"("token") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_usage_summary" ADD CONSTRAINT "user_usage_summary_user_token_fkey" FOREIGN KEY ("user_token") REFERENCES "UserAccessToken"("token") ON DELETE RESTRICT ON UPDATE CASCADE;
