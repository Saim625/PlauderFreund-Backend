import { synthesizeSpeech } from "./ttsService.js";
import logger from "../utils/logger.js";

let lastErrorTime = 0; // timestamp of last error message
const ERROR_COOLDOWN = 5000; // 5 seconds

export async function handleError(
  error,
  socket,
  message = "Connection issue, please wait a moment."
) {
  const now = Date.now();
  if (now - lastErrorTime < ERROR_COOLDOWN) {
    // Too soon, just log silently
    logger.error("❌ Suppressed error:", error.message || error);
    return;
  }
  lastErrorTime = now;

  logger.error("❌ Pipeline Error:", error.message || error);

  try {
    const audioBuffer = await synthesizeSpeech(message);
    socket.emit("error-response", {
      message,
      audio: audioBuffer.toString("base64"),
    });
  } catch (ttsError) {
    logger.error("❌ Error creating TTS for error:", ttsError.message);
    socket.emit("error-response", { message });
  }
}
