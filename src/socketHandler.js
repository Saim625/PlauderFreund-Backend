import logger from "./utils/logger.js";

export default function registerSocketHandler(socket) {
  socket.on("audio-chunks", (data) => {
    logger.info("🎤 Received audio chunk:", data);

    socket.emit("ai-response-audio", { message: "Hello from server" });
  });
}
