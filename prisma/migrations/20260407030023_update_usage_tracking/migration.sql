/*
  Warnings:

  - You are about to drop the column `realtime_input_tokens` on the `session_logs` table. All the data in the column will be lost.
  - You are about to drop the column `total_realtime_input_tokens` on the `user_usage_summary` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "session_logs" DROP COLUMN "realtime_input_tokens",
ADD COLUMN     "realtime_audio_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "realtime_cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "realtime_text_input_tokens" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_usage_summary" DROP COLUMN "total_realtime_input_tokens",
ADD COLUMN     "total_realtime_audio_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_realtime_cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_realtime_text_input_tokens" INTEGER NOT NULL DEFAULT 0;
