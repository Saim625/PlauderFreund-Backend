// features/realtimeHandler.js

import { connectToRealtimeAPI } from "../services/realtimeService.js";
import logger from "../utils/logger.js";
import {
  initElevenLabs,
  startContext,
  sendTextToElevenLabs,
  closeContext,
  closeElevenLabs,
} from "../services/elevenlabWS.js";

export async function handleRealtimeAI(socket) {
  let gptWs;
  let currentContextId = null;
  let isContextClosing = false;
  let currentResponseId = null; // ✅ NEW: Track current GPT response

  try {
    gptWs = await connectToRealtimeAPI();
    logger.info("✅ [GPT] Connected to Realtime API");
  } catch (err) {
    logger.error("❌ [GPT] Failed to connect:", err);
    socket.emit("ai-error", { message: "AI connection failed." });
    return;
  }

  // Initialize ElevenLabs multi-context once
  initElevenLabs((audioObj) => {
    logger.info(
      `🎶 [FLOW] Audio chunk → FE (context: ${audioObj.contextId}, final: ${audioObj.isFinal})`
    );
    socket.emit("ai-audio-chunk", audioObj);

    // ✅ When final audio received, close context after delay
    if (audioObj.isFinal && audioObj.contextId === currentContextId) {
      logger.info(`🏁 [FLOW] Final audio for ${audioObj.contextId}`);
      isContextClosing = true;

      setTimeout(() => {
        if (audioObj.contextId === currentContextId) {
          closeContext(audioObj.contextId);
          currentContextId = null;
          isContextClosing = false;
        }
      }, 200);
    }
  });

  gptWs.on("message", (msg) => {
    const event = JSON.parse(msg.toString());

    // ✅ NEW: Handle interruption (user starts speaking while AI is responding)
    if (event.type === "input_audio_buffer.speech_started") {
      logger.info("🎙️ [INTERRUPTION] User started speaking");

      // 1️⃣ Check if there's an active response to interrupt
      if (currentContextId && !isContextClosing) {
        logger.warn(
          `⚠️ [INTERRUPTION] Canceling active response (context: ${currentContextId})`
        );

        // 2️⃣ Tell frontend to stop audio immediately
        socket.emit("ai-interrupt");

        // 3️⃣ Cancel current GPT response
        if (currentResponseId) {
          logger.info(`🛑 [GPT] Canceling response: ${currentResponseId}`);
          gptWs.send(
            JSON.stringify({
              type: "response.cancel",
            })
          );
        }

        // 4️⃣ Close old ElevenLabs context
        logger.info(
          `🧹 [ELEVEN] Closing interrupted context: ${currentContextId}`
        );
        closeContext(currentContextId);

        // 5️⃣ Reset state
        currentContextId = null;
        currentResponseId = null;
        isContextClosing = false;
      }
    }

    // When GPT starts responding, create new ElevenLabs context
    if (event.type === "response.created") {
      logger.info("🎬 [GPT] Response started");
      currentResponseId = event.response?.id; // ✅ Track response ID

      // Close old context if exists (safety check)
      if (currentContextId && !isContextClosing) {
        logger.info(`🧹 [FLOW] Closing old context: ${currentContextId}`);
        closeContext(currentContextId);
      }

      // Start new context
      currentContextId = startContext();
      isContextClosing = false;
      logger.info(`🆕 [FLOW] New context started: ${currentContextId}`);
    }

    // Send text chunks to ElevenLabs
    if (event.type === "response.output_text.delta") {
      const textChunk = event.delta;

      if (currentContextId && !isContextClosing) {
        sendTextToElevenLabs(textChunk, currentContextId);
      } else {
        logger.warn(
          `⚠️ [FLOW] Received text but context invalid (contextId: ${currentContextId}, closing: ${isContextClosing})`
        );
      }
    }

    // GPT finished generating text
    if (event.type === "response.output_text.done") {
      logger.info("🏁 [GPT] Text stream done — flushing ElevenLabs buffer");

      if (currentContextId && !isContextClosing) {
        sendTextToElevenLabs("", currentContextId, { flush: true });
      }
    }

    // Overall response complete
    if (event.type === "response.done") {
      logger.info("✅ [GPT] Response complete");
      socket.emit("ai-response-done", { response: event.response });
      currentResponseId = null; // ✅ Clear response ID
    }

    // ✅ NEW: Handle response cancellation confirmation
    if (event.type === "response.cancelled") {
      logger.info("✅ [GPT] Response cancelled successfully");
      currentResponseId = null;
    }
  });

  socket.on("audio-chunk", (chunkArrayBuffer) => {
    try {
      const base64Audio = Buffer.from(chunkArrayBuffer).toString("base64");
      gptWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        })
      );
      logger.debug("🎤 [FLOW] Audio chunk → GPT");
    } catch (err) {
      logger.error("❌ [FLOW] Error forwarding audio to GPT:", err);
    }
  });

  socket.on("disconnect", () => {
    logger.info(`🔴 [SOCKET] Client disconnected: ${socket.id}`);

    // Close current context if exists
    if (currentContextId) {
      closeContext(currentContextId);
    }

    gptWs?.close();
    closeElevenLabs("manual-disconnect");
  });
}
