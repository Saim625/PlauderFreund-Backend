import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import healthRoute from "./routes/health.js";
import registerSocketHandler from "./socketHandler.js";
import logger from "./utils/logger.js";
import { PORT } from "./config/env.js";

const app = express();

app.use(express.json());

app.use("/", healthRoute);

const httpServer = createServer(app);

// Updated Socket.IO config
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"], // Add polling fallback
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  logger.info(`🟢 Client connected: ${socket.id}`);
  registerSocketHandler(socket);

  socket.on("disconnect", () => {
    logger.info(`🔴 Client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  logger.info(`✅ Server running on http://localhost:${PORT}`);
});
