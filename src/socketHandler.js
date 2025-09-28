import { generateReply } from "./services/gptService.js";
import { transcribeAudio } from "./services/sttService.js";
import { synthesizeSpeech } from "./services/ttsService.js";
import logger from "./utils/logger.js";

export default function registerSocketHandler(socket) {
  socket.on("audio-chunks", async (audioData) => {
    try {
      logger.info(`🎤 Received audio chunk from ${socket.id}`);

      const transcript = await transcribeAudio(audioData);

      const aiReply = await generateReply(transcript);

      const audioBuffer = await synthesizeSpeech(aiReply);

      socket.emit("ai-response", {
        transcript,
        reply: aiReply,
        audio: audioBuffer.toString("base64"),
      });
    } catch (err) {
      logger.error(`❌ Error in STT pipeline: ${err.message}`);
      socket.emit("error", { message: "STT failed, please try again" });
    }
  });
}
