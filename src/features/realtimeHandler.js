import { connectToRealtimeAPI } from "../services/realtimeService.js";
import logger from "../utils/logger.js";
import {
  initElevenLabs,
  ensureElevenLabsReady,
  startContext,
  sendTextToElevenLabs,
  closeContext,
  getElevenLabsStatus,
} from "../services/elevenlabWS.js";
import MemorySummary from "../models/MemorySummary.js";

export async function handleRealtimeAI(socket, token) {
  let gptWs;
  let currentContextId = null;
  let isContextClosing = false;
  let currentResponseId = null;
  let contextCleanupTimer = null;
  let textChunkCount = 0;
  let audioChunkCount = 0;

  try {
    initElevenLabs();

    // 🔥 STEP 2: Wait for ElevenLabs to be ready (CRITICAL FIX)
    await ensureElevenLabsReady();
    // 🔥 STEP 3: Load memory
    const memory = await MemorySummary.findOne({ token });
    const summary = memory?.summary || [];

    // 🔥 STEP 4: Connect to GPT Realtime API
    gptWs = await connectToRealtimeAPI(summary);
  } catch (err) {
    logger.error(
      `❌ [INIT] Initialization failed for Socket ${socket.id}:`,
      err
    );
    socket.emit("ai-error", {
      message: "AI connection failed: " + err.message,
    });
    return;
  }

  gptWs.on("message", (msg) => {
    const event = JSON.parse(msg.toString());

    if (event.type === "input_audio_buffer.speech_started") {
      // 1️⃣ Cancel cleanup timer
      if (contextCleanupTimer) {
        clearTimeout(contextCleanupTimer);
        contextCleanupTimer = null;
      }

      // 2️⃣ Check if there's an active response to interrupt
      if (currentContextId && !isContextClosing) {
        socket.emit("ai-interrupt");

        // 4️⃣ Cancel GPT response
        if (currentResponseId) {
          gptWs.send(JSON.stringify({ type: "response.cancel" }));
        }

        const closeResult = closeContext(currentContextId);
        logger.info(`🧹 [ELEVEN] Context close result: ${closeResult}`);

        // 6️⃣ Reset state
        currentContextId = null;
        currentResponseId = null;
        isContextClosing = false;
        textChunkCount = 0;
        audioChunkCount = 0;
      } else {
        logger.info(
          `ℹ️ [INTERRUPT] No active context to cancel | contextId=${currentContextId}, closing=${isContextClosing}`
        );
      }
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      const userTranscript = event.transcript;
      socket.emit("user-transcript", {
        text: userTranscript,
        timestamp: new Date().toISOString(),
      });
    }

    if (event.type === "response.created") {
      currentResponseId = event.response?.id;

      textChunkCount = 0;
      audioChunkCount = 0;

      // 1️⃣ Cancel any running cleanup timer
      if (contextCleanupTimer) {
        clearTimeout(contextCleanupTimer);
        contextCleanupTimer = null;
      }

      // 2️⃣ Close old context if exists (safety check)
      if (currentContextId && !isContextClosing) {
        closeContext(currentContextId);
      }

      // 3️⃣ Check ElevenLabs status before starting new context
      const elevenStatus = getElevenLabsStatus();

      if (!elevenStatus.ready) {
        logger.error(
          `❌ [RESPONSE START] ElevenLabs not ready! Cannot start context.`
        );
        socket.emit("ai-error", { message: "TTS service not ready" });
        return;
      }

      // 4️⃣ Start new ElevenLabs context
      currentContextId = startContext(socket);

      if (!currentContextId) {
        socket.emit("ai-error", { message: "TTS context creation failed" });
      } else {
        isContextClosing = false;
      }
    }

    if (event.type === "response.output_text.delta") {
      const textChunk = event.delta;
      textChunkCount++;

      if (!currentContextId) {
        logger.error(
          `❌ [TEXT CHUNK #${textChunkCount}] No contextId! Cannot send to ElevenLabs`
        );
        return;
      }

      if (isContextClosing) {
        logger.error(
          `⚠️ [TEXT CHUNK #${textChunkCount}] Context is closing, skipping chunk`
        );
        return;
      }

      // Double-check ElevenLabs status
      const elevenStatus = getElevenLabsStatus();
      if (!elevenStatus.ready) {
        logger.error(
          `❌ [TEXT CHUNK #${textChunkCount}] ElevenLabs disconnected mid-stream! | wsState=${elevenStatus.wsState}`
        );
        socket.emit("ai-error", {
          message: "TTS connection lost during stream",
        });
        return;
      }
      const sendResult = sendTextToElevenLabs(textChunk, currentContextId);
    }

    if (event.type === "response.output_text.done") {
      const fullAiResponse = event.text;

      // Send transcript to frontend
      socket.emit("ai-transcript", {
        text: fullAiResponse,
        timestamp: new Date().toISOString(),
      });

      // Flush ElevenLabs buffer
      if (currentContextId && !isContextClosing) {
        const flushResult = sendTextToElevenLabs("", currentContextId, {
          flush: true,
        });
      } else {
        logger.warn(
          `⚠️ [FLUSH] Cannot flush | contextId=${currentContextId}, closing=${isContextClosing}`
        );
      }
    }

    if (event.type === "response.done") {
      socket.emit("ai-response-done", { response: event.response });
      currentResponseId = null;
    }

    if (event.type === "response.cancelled") {
      currentResponseId = null;
      textChunkCount = 0;
      audioChunkCount = 0;
    }
  });

  socket.on("audio-chunk", (chunkArrayBuffer) => {
    try {
      const base64Audio = Buffer.from(chunkArrayBuffer).toString("base64");
      const audioSize = base64Audio.length;

      gptWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        })
      );
    } catch (err) {
      logger.error(
        `❌ [AUDIO FORWARD] Error forwarding audio to GPT | Socket: ${socket.id}:`,
        err
      );
    }
  });

  socket.on("ai-audio-complete", ({ contextId }) => {
    if (contextId === currentContextId) {
      // Close the context now that audio is done
      const closeResult = closeContext(contextId);

      currentContextId = null;
      isContextClosing = false;
      textChunkCount = 0;
      audioChunkCount = 0;
    } else {
      logger.error(
        `⚠️ [AUDIO COMPLETE] Context mismatch! Received: ${contextId}, Current: ${currentContextId}`
      );
    }
  });

  socket.on("disconnect", () => {
    // Clean up timer
    if (contextCleanupTimer) {
      clearTimeout(contextCleanupTimer);
    }

    // Close current context if exists
    if (currentContextId) {
      const closeResult = closeContext(currentContextId);
    }

    // Close GPT WebSocket
    if (gptWs) {
      gptWs.close();
    }

    // Log final status
    const elevenStatus = getElevenLabsStatus();
  });
}
