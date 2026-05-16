/*
  Warnings:

  - A unique constraint covering the columns `[provider,model,price_type]` on the table `provider_pricing` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `model` to the `provider_pricing` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "provider_pricing_provider_price_type_key";

-- AlterTable
ALTER TABLE "PersonalityConfig" ADD COLUMN     "chat_model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
ADD COLUMN     "realtime_model" TEXT NOT NULL DEFAULT 'gpt-4o-realtime-preview';

-- AlterTable
ALTER TABLE "provider_pricing" ADD COLUMN     "model" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "session_logs" ADD COLUMN     "chat_model_used" TEXT,
ADD COLUMN     "realtime_model_used" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "provider_pricing_provider_model_price_type_key" ON "provider_pricing"("provider", "model", "price_type");
