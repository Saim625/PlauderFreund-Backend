import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import healthRoute from "./routes/health.js";
import registerSocketHandler from "./socketHandler.js";
import logger from "./utils/logger.js";
import { PORT } from "./config/env.js";
import { DB_CONNECTION } from "./config/database.js";
import prisma from "./lib/db.js";
import { authRouter } from "./routes/auth.js";
import { memoryRouter } from "./routes/memory.js";
import cors from "cors";
import { greetingRouter } from "./routes/greeting.js";
import { adminRouter } from "./routes/adminDashboardRoutes/adminDashboardRoutes.js";
import { actionRouter } from "./routes/adminDashboardRoutes/userManagementRoutes/actions.js";
import { adminActionRouter } from "./routes/adminDashboardRoutes/adminManagementRoutes/actions.js";
import { summaryEditorRouter } from "./routes/adminDashboardRoutes/userManagementRoutes/summaryEditorRoutes/summaryEditorAction.js";
import { personalityActionRouter } from "./routes/adminDashboardRoutes/personalityConfigRoutes/personalityActions.js";
import { adminPasswordRouter } from "./routes/adminPasswordRecovery/passwordRecovery.js";
import { startReengagementLoop } from "./services/reengagementEngine.js";
import { cleanupAllConnections } from "./services/elevenlabWS.js";
import {
  startReminderCleanup,
  startReminderScheduler,
} from "./services/reminderScheduler.js";
import { usageRouter } from "./routes/adminDashboardRoutes/usageRoutes.js";

import path from "path";
import { avatarRouter } from "./routes/avatarRoutes.js";

const app = express();

const corsOptions = {
  origin: [
    "https://plauderfreund.de",
    "http://localhost:5173",
    "capacitor://localhost", // 👈 iOS Capacitor
    "http://localhost",
  ], // 👈 Android Capacitor],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true, // optional but recommended
};

app.use(cors(corsOptions));

app.options(/.*/, cors(corsOptions));

app.use(express.json());

app.use("/", healthRoute);
app.use("/api/auth", authRouter);
app.use("/api/memory", memoryRouter);
app.use("/api", greetingRouter);
app.use("/api", adminRouter);
app.use("/api", actionRouter);
app.use("/api", adminActionRouter);
app.use("/api", summaryEditorRouter);
app.use("/api", personalityActionRouter);
app.use("/api", adminPasswordRouter);
app.use("/api", usageRouter);
app.use("/api", avatarRouter);
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

const httpServer = createServer(app);

// Updated Socket.IO config
const io = new Server(httpServer, {
  cors: {
    origin: ["https://plauderfreund.de", "http://localhost:5173"], // 👈 Android Capacitor],
    methods: ["GET", "POST"],
  },
  transports: ["polling", "websocket"], // Add polling fallback
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

startReengagementLoop((socketId) => {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) {
    return;
  }
  socket.emit("reengagement-needed");
});

startReminderScheduler();
startReminderCleanup();

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

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("🛑 SIGTERM received, cleaning up...");
  cleanupAllConnections();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("🛑 SIGINT received, cleaning up...");
  cleanupAllConnections();
  await prisma.$disconnect();
  process.exit(0);
});
