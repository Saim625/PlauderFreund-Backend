-- AlterTable
ALTER TABLE "session_logs" ADD COLUMN     "realtime_cached_audio_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whisper_seconds" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_usage_summary" ADD COLUMN     "total_realtime_cached_audio_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_whisper_seconds" INTEGER NOT NULL DEFAULT 0;
