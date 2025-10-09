// features/realtimeHandler.js
import { connectToRealtimeAPI } from "../services/realtimeService.js";
import { synthesizeTTS } from "../services/ttsService.js";
import logger from "../utils/logger.js";

export async function handleRealtimeAI(socket) {
  let gptWs;

  try {
    gptWs = await connectToRealtimeAPI();
  } catch (err) {
    logger.error("❌ Failed to connect GPT Realtime:", err);
    socket.emit("ai-error", { message: "AI connection failed." });
    return;
  }

  gptWs.on("message", (msg) => {
    const event = JSON.parse(msg.toString());

    // server-side VAD & lifecycle events for debugging
    if (event.type === "input_audio_buffer.speech_started") {
      logger.info("🟢 GPT: input_audio_buffer.speech_started");
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      logger.info("🔴 GPT: input_audio_buffer.speech_stopped");
    }

    // audio chunks (Base64 PCM)
    if (event.type === "response.output_audio.delta") {
      const base64Chunk = event.delta; // base64 PCM bytes
      // forward chunk to FE
      socket.emit("ai-audio-chunk", base64Chunk);
      logger.info(`🎧 Forwarded AI audio chunk (${event.delta.length} bytes)`);
    }

    // audio finished for this response
    if (event.type === "response.output_audio.done") {
      logger.info("✅ GPT finished generating audio response");
      socket.emit("ai-audio-done", { responseId: event.response?.id });
    }

    // overall response finished
    if (event.type === "response.done") {
      logger.info("✅ GPT response.done received");
      // optionally include metadata or final text
      socket.emit("ai-response-done", { response: event.response });
    }
  });

  socket.on("audio-chunk", (chunkArrayBuffer) => {
    try {
      // chunkArrayBuffer is binary ArrayBuffer from FE
      const base64Audio = Buffer.from(chunkArrayBuffer).toString("base64");
      gptWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        })
      );
      logger.info("🎤 Received audio chunk from FE and appended to GPT");
    } catch (err) {
      logger.error("❌ Error appending audio chunk to GPT:", err);
    }
  });

  // Cleanup
  socket.on("disconnect", () => {
    logger.info(`🔴 Socket disconnected: ${socket.id}`);
    gptWs?.close();
  });
}
