import { handleRealtimeAI } from "./features/realtimeHandler.js";
import { sessionRegistry } from "./services/sessionRegistry.js";
import { setSession, deleteSession } from "./services/sessionStore.js";

export default function registerSocketHandler(socket) {
  socket.on("start-realtime", ({ token, timezone }) => {
    const sessionId = socket.id;
    console.log("RegisterSocketHandler", sessionId);
    // Track this socket by token so reminder scheduler can reach it
    setSession(token, socket);

    sessionRegistry.register(token, sessionId);

    // Clean up session store on disconnect
    socket.on("disconnect", () => {
      deleteSession(token);
      sessionRegistry.unregister(token);
    });

    handleRealtimeAI(socket, token, timezone);
  });
}
