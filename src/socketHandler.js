import { handleRealtimeAI } from "./features/realtimeHandler.js";

export default function registerSocketHandler(socket) {
  // 🗣️ Handle Realtime AI audio conversation
  handleRealtimeAI(socket);
}
