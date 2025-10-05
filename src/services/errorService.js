// import { synthesizeSpeech } from "./ttsService.js";
// import logger from "../utils/logger.js";

// export async function handleError(
//   err,
//   socket,
//   userMessage = "Something went wrong. Please try again."
// ) {
//   try {
//     logger.error(`❌ Pipeline Error: ${err.message}`);

//     const errorText = userMessage;

//     let audioBuffer = null;
//     try {
//       audioBuffer = await synthesizeSpeech(errorText);
//     } catch (ttsErr) {
//       logger.error(`❌ Failed to convert error to audio: ${ttsErr.message}`);
//     }

//     socket.emit("error-response", {
//       message: errorText,
//       audio: audioBuffer ? audioBuffer.toString("base64") : null,
//     });
//   } catch (finalErr) {
//     logger.error(`❌ ErrorService completely failed: ${finalErr.message}`);
//   }
// }

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
