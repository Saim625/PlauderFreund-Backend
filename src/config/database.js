import prisma from "../lib/db.js";
import logger from "../utils/logger.js";

export async function DB_CONNECTION() {
  try {
    await prisma.$connect();
    logger.info("✅ Connected to PostgreSQL via Prisma");
    return prisma;
  } catch (error) {
    logger.error("❌ Database connection failed:", error);
    throw error;
  }
}

// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

