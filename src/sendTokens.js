import mongoose from "mongoose";
import dotenv from "dotenv";
import { MONGO_URI } from "./config/env.js";
import AdminAccessToken from "./models/AdminAccessToken.js";

dotenv.config();

await mongoose.connect(MONGO_URI);
console.log("✅ Connected to MongoDB");

const tokens = [{ token: "developer", role: "MAIN_ADMIN" }];

await AdminAccessToken.insertMany(tokens);

console.log("✅ Tokens inserted:");
tokens.forEach((t) => console.log(t.token));

await mongoose.disconnect();
console.log("🔌 MongoDB disconnected");
