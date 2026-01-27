import dotenv from "dotenv";
import prisma from "./lib/db.js";

dotenv.config();

const createTokens = async () => {
  try {
    // 1. Prepare the data (only 'token' is needed, isActive and createdAt are automatic)
    const tokenStrings = [
      "123mno456",
      "mno333wse",
      "792f013",
      "ac807f7",
      "9236bce",
      "3c41c02",
      "388c4ac",
      "76ff7ae",
    ];

    // Format them for Prisma
    const tokensToInsert = tokenStrings.map((t) => ({ token: t }));

    console.log("⏳ Connecting to PostgreSQL...");
    await prisma.$connect();

    console.log("✅ Connected! Starting insertion...");

    // 2. Loop and Create
    for (const tokenData of tokensToInsert) {
      await prisma.userAccessToken.create({
        data: tokenData,
      });
    }

    console.log(`✅ Successfully inserted ${tokensToInsert.length} tokens.`);

    await prisma.$disconnect();
  } catch (error) {
    console.error("❌ Error injecting tokens:", error);
    // If you get a 'Unique constraint' error, it means the token is already in the DB
    await prisma.$disconnect();
    process.exit(1);
  }
};

createTokens();
