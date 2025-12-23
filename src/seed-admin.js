import bcrypt from "bcrypt";
import AdminAccountPassword from "./models/AdminAccountPassword.js";
import mongoose from "mongoose";
import { MONGO_URI } from "./config/env.js";
import dotenv from "dotenv";

dotenv.config();

const createMainAdmin = async () => {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const passwordHash = await bcrypt.hash("Admin@1212", 12);

  await AdminAccountPassword.create({
    role: "MAIN_ADMIN",
    passwordHash,
  });

  console.log("MAIN_ADMIN created");

  await mongoose.disconnect();
  console.log("🔌 MongoDB disconnected");
};

createMainAdmin();
