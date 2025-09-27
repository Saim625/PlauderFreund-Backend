import express from "express";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import healthRoute from "./routes/health.js";
import registerSocketHandler from "./socketHandler.js";
import logger from "./utils/logger.js";

dotenv.config();

const app = express();

app.use("/", healthRoute);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  logger.info("🟢 Client connected:", socket.id);
  registerSocketHandler(socket);

  socket.on("disconnect", (socket) => {
    logger.info("🔴 Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`✅ Server running on http://localhost:${PORT}`);
});
