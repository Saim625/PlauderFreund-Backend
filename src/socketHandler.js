import { handleRealtimeAI } from "./features/realtimeHandler.js";

export default function registerSocketHandler(socket) {
  socket.on("start-realtime", ({ token }) => {
    console.log("🪄 Received start-realtime event with token:", token);

    // Pass token along to your realtime handler
    handleRealtimeAI(socket, token);
  });
}
