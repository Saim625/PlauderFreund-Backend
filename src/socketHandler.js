import { handleRealtimeAI } from "./features/realtimeHandler.js";
import { setSession, deleteSession } from "./services/sessionStore.js";

export default function registerSocketHandler(socket) {
  socket.on("start-realtime", ({ token, timezone }) => {
    console.log("🪄 Received start-realtime event with token:", token);

    // Track this socket by token so reminder scheduler can reach it
    setSession(token, socket);

    // Clean up session store on disconnect
    socket.on("disconnect", () => {
      deleteSession(token);
    });

    handleRealtimeAI(socket, token, timezone);
  });
}
