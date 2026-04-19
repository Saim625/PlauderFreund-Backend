/*
  Warnings:

  - You are about to drop the column `month` on the `operational_costs` table. All the data in the column will be lost.
  - Added the required column `start_date` to the `operational_costs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RecurrenceType" AS ENUM ('one_time', 'monthly', 'yearly');

-- AlterTable
ALTER TABLE "operational_costs" DROP COLUMN "month",
ADD COLUMN     "recurrence" "RecurrenceType" NOT NULL DEFAULT 'one_time',
ADD COLUMN     "start_date" TIMESTAMPTZ NOT NULL;
