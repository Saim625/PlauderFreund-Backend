import prisma from "./lib/db.js";
import dotenv from "dotenv";

dotenv.config();

const createMainAdminToken = async () => {
  try {
    console.log("⏳ Connecting to VPS Database...");
    await prisma.$connect();

    const mainAdminToken = "abc111def"; // Change this!

    const admin = await prisma.adminAccessToken.create({
      data: {
        token: mainAdminToken,
        role: "MAIN_ADMIN",
        isActive: true,
        // Giving full permissions to the Main Admin
        canManageUsers: true,
        canCreateTokens: true,
        canDeleteTokens: true,
        canEditAdmin: true,
        canAccessMemoryEditor: true,
        canAccessPersonalisedConfig: true,
      },
    });

    console.log("✅ MAIN_ADMIN Access Token Created Successfully:");
    console.table({
      ID: admin.id,
      Role: admin.role,
      Token: admin.token,
      Active: admin.isActive,
    });

    await prisma.$disconnect();
  } catch (error) {
    if (error.code === "P2002") {
      console.error("❌ Error: This token already exists in the database.");
    } else {
      console.error("❌ Error creating admin token:", error);
    }
    await prisma.$disconnect();
    process.exit(1);
  }
};

createMainAdminToken();
