import express from "express";
import dotenv from "dotenv";
import healthRoute from "./routes/health.js";

dotenv.config();

const app = express();

app.use("/", healthRoute);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
