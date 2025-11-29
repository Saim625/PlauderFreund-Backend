import mongoose from "mongoose";
import UserAccessToken from "./models/UserAccessToken.js";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import { MONGO_URI } from "./config/env.js";

dotenv.config();

await mongoose.connect(MONGO_URI);
console.log("✅ Connected to MongoDB");

const tokens = [
  { token: "abc123wxy" },
  { token: "def456xyz" },
  { token: "lmn657uuy" },
  { token: "opq234rst" },
  { token: "123mno456" },
  { token: "mno333wse" },
  { token: "seo324qwq" },

  //   { token: uuidv4() }, // auto-generated random token
];

await UserAccessToken.insertMany(tokens);

console.log("✅ Tokens inserted:");
tokens.forEach((t) => console.log(t.token));

await mongoose.disconnect();
console.log("🔌 MongoDB disconnected");
