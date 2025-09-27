import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import healthRoute from "./routes/health.js";
import sttRoute from "./routes/stt.js";
import gptRoute from "./routes/gpt.js";
import registerSocketHandler from "./socketHandler.js";
import logger from "./utils/logger.js";
import { PORT } from "./config/env.js";

const app = express();

app.use(express.json());

app.use("/", healthRoute);
app.use("/", sttRoute);
app.use("/", gptRoute);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  logger.info("🟢 Client connected:", socket.id);
  registerSocketHandler(socket);

  socket.on("disconnect", () => {
    logger.info("🔴 Client disconnected:", socket.id);
  });
});

httpServer.listen(PORT, () => {
  logger.info(`✅ Server running on http://localhost:${PORT}`);
});
