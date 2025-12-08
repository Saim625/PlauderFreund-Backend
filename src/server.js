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
import { adminRouter } from "./routes/adminDashboardRoutes/adminDashboardRoutes.js";
import { actionRouter } from "./routes/adminDashboardRoutes/userManagementRoutes/actions.js";

const app = express();

const corsOptions = {
  origin: ["https://plauderfreund.de", "http://localhost:5173"],
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

const httpServer = createServer(app);

// Updated Socket.IO config
const io = new Server(httpServer, {
  cors: {
    origin: "https://plauderfreund.de",
    methods: ["GET", "POST"],
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
