import mongoose from "mongoose";
import { MONGO_URI } from "./env.js";

export const DB_CONNECTION = async () => {
  await mongoose.connect(MONGO_URI);
};
