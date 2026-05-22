import { handleRealtimeAI } from "./features/realtimeHandler.js";
import { sessionRegistry } from "./services/sessionRegistry.js";
import { setSession, deleteSession } from "./services/sessionStore.js";

export default function registerSocketHandler(socket) {
  socket.on("start-realtime", ({ token, timezone }) => {
    console.log("🎯 start-realtime received for socket:", socket.id);

    const sessionId = socket.id;
    // Track this socket by token so reminder scheduler can reach it
    setSession(token, socket);

    sessionRegistry.register(token, sessionId);

    handleRealtimeAI(socket, token, timezone);

    // Clean up session store on disconnect
    socket.on("disconnect", () => {
      deleteSession(token);
      sessionRegistry.unregister(token);
    });
  });
}
