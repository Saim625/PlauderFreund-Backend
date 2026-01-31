/*
  Warnings:

  - A unique constraint covering the columns `[number]` on the table `UserAccessToken` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "UserAccessToken" ADD COLUMN     "number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UserAccessToken_number_key" ON "UserAccessToken"("number");
