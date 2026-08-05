import { handleRealtimeAI } from "./features/realtimeHandler.js";
import { sessionRegistry } from "./services/sessionRegistry.js";
import { setSession, deleteSession } from "./services/sessionStore.js";
import { saveUserTimezoneToMemory } from "./utils/userTimezoneMemory.js";

export default function registerSocketHandler(socket) {
  socket.on("start-realtime", async ({ token, timezone }) => {
    console.log("🎯 start-realtime received for socket:", socket.id);

    const sessionId = socket.id;
    // Track this socket by token so reminder scheduler can reach it
    setSession(token, socket);

    sessionRegistry.register(token, sessionId);

    // A browser can identify its IANA timezone accurately. Persist it so a
    // later phone call uses the same local-time context.
    if (timezone) {
      try {
        await saveUserTimezoneToMemory(token, timezone);
      } catch (err) {
        console.warn(`⚠️ Could not save timezone for ${sessionId}: ${err.message}`);
      }
    }

    handleRealtimeAI(socket, token, timezone);

    // Clean up session store on disconnect
    socket.on("disconnect", () => {
      deleteSession(token);
      sessionRegistry.unregister(token);
    });
  });
}
