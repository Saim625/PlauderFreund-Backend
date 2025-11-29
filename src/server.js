import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import healthRoute from "./routes/health.js";
import registerSocketHandler from "./socketHandler.js";
import logger from "./utils/logger.js";
import { PORT } from "./config/env.js";
import { DB_CONNECTION } from "./config/database.js";
import { authRouter } from "./routes/auth.js";
import { memoryRouter } from "./routes/memory.js";
import cors from "cors";
import { greetingRouter } from "./routes/greeting.js";

const app = express();

app.use(
  cors({
    origin: ["https://plauderfreund.de"], // ✅ your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // if you're using cookies or auth headers
  })
);

app.use(express.json());

app.use("/", healthRoute);
app.use("/api/auth", authRouter);
app.use("/api/memory", memoryRouter);
app.use("/api", greetingRouter);

const httpServer = createServer(app);

// Updated Socket.IO config
const io = new Server(httpServer, {
  cors: {
    origin: "https://plauderfreund.de",
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

DB_CONNECTION()
  .then(() => {
    logger.info("Connected to Database");
    httpServer.listen(PORT, () => {
      logger.info(`✅ Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err);
  });
