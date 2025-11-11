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
  logger.info(`🚀 [INIT] handleRealtimeAI called for Socket ${socket.id}`);

  let gptWs;
  let currentContextId = null;
  let isContextClosing = false;
  let currentResponseId = null;
  let contextCleanupTimer = null;
  let textChunkCount = 0;
  let audioChunkCount = 0;

  try {
    // 🔥 STEP 1: Initialize ElevenLabs first
    logger.info(
      `📡 [INIT] Step 1: Initializing ElevenLabs for Socket ${socket.id}`
    );
    initElevenLabs();

    // 🔥 STEP 2: Wait for ElevenLabs to be ready (CRITICAL FIX)
    logger.info(`⏳ [INIT] Step 2: Waiting for ElevenLabs to be ready...`);
    await ensureElevenLabsReady();
    logger.info(`✅ [INIT] Step 2 Complete: ElevenLabs is ready`);

    // 🔥 STEP 3: Load memory
    logger.info(`🧠 [INIT] Step 3: Loading memory for token ${token}`);
    const memory = await MemorySummary.findOne({ token });
    const summary = memory?.summary || [];
    logger.info(`🧠 [INIT] Memory loaded: ${summary.length} entries`);

    // 🔥 STEP 4: Connect to GPT Realtime API
    logger.info(`🤖 [INIT] Step 4: Connecting to GPT Realtime API...`);
    gptWs = await connectToRealtimeAPI(summary);
    logger.info(`✅ [INIT] All systems ready for Socket ${socket.id}`);
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

  // ============================================================================
  // GPT REALTIME API MESSAGE HANDLERS
  // ============================================================================

  gptWs.on("message", (msg) => {
    const event = JSON.parse(msg.toString());
    logger.info(
      `📨 [GPT->BE] Received event: ${event.type} | Socket: ${socket.id}`
    );

    // ------------------------------------------------------------------------
    // INTERRUPTION: User starts speaking while AI is responding
    // ------------------------------------------------------------------------
    if (event.type === "input_audio_buffer.speech_started") {
      logger.info(
        `🎙️ [INTERRUPT] User started speaking | Socket: ${socket.id}`
      );
      logger.info(
        `📊 [INTERRUPT] Current state: contextId=${currentContextId}, responseId=${currentResponseId}, closing=${isContextClosing}`
      );

      // 1️⃣ Cancel cleanup timer
      if (contextCleanupTimer) {
        clearTimeout(contextCleanupTimer);
        contextCleanupTimer = null;
        logger.info(`⏳ [INTERRUPT] Cleanup timer canceled`);
      }

      // 2️⃣ Check if there's an active response to interrupt
      if (currentContextId && !isContextClosing) {
        logger.warn(
          `⚠️ [INTERRUPT] Canceling active response | Context: ${currentContextId}`
        );

        // 3️⃣ Tell frontend to stop audio immediately
        logger.info(
          `📤 [BE->FE] Emitting 'ai-interrupt' to Socket ${socket.id}`
        );
        socket.emit("ai-interrupt");

        // 4️⃣ Cancel GPT response
        if (currentResponseId) {
          logger.info(
            `🛑 [GPT] Sending response.cancel for responseId: ${currentResponseId}`
          );
          gptWs.send(JSON.stringify({ type: "response.cancel" }));
        }

        // 5️⃣ Close ElevenLabs context
        logger.info(
          `🧹 [ELEVEN] Closing interrupted context: ${currentContextId}`
        );
        const closeResult = closeContext(currentContextId);
        logger.info(`🧹 [ELEVEN] Context close result: ${closeResult}`);

        // 6️⃣ Reset state
        currentContextId = null;
        currentResponseId = null;
        isContextClosing = false;
        textChunkCount = 0;
        audioChunkCount = 0;
        logger.info(`🔄 [STATE] State reset complete`);
      } else {
        logger.info(
          `ℹ️ [INTERRUPT] No active context to cancel | contextId=${currentContextId}, closing=${isContextClosing}`
        );
      }
    }

    // ------------------------------------------------------------------------
    // USER TRANSCRIPT: Capture user's transcribed speech
    // ------------------------------------------------------------------------
    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      const userTranscript = event.transcript;
      logger.info(`📝 [USER SPEECH] Socket ${socket.id}: "${userTranscript}"`);
      logger.info(
        `📤 [BE->FE] Emitting 'user-transcript' to Socket ${socket.id}`
      );

      socket.emit("user-transcript", {
        text: userTranscript,
        timestamp: new Date().toISOString(),
      });
    }

    // ------------------------------------------------------------------------
    // RESPONSE CREATED: GPT starts responding
    // ------------------------------------------------------------------------
    if (event.type === "response.created") {
      currentResponseId = event.response?.id;
      textChunkCount = 0;
      audioChunkCount = 0;

      logger.info(
        `🎬 [RESPONSE START] GPT response created | Socket: ${socket.id} | ResponseId: ${currentResponseId}`
      );

      // 1️⃣ Cancel any running cleanup timer
      if (contextCleanupTimer) {
        clearTimeout(contextCleanupTimer);
        contextCleanupTimer = null;
        logger.info(`⏳ [RESPONSE START] Cleanup timer canceled`);
      }

      // 2️⃣ Close old context if exists (safety check)
      if (currentContextId && !isContextClosing) {
        logger.warn(
          `🧹 [RESPONSE START] Old context still exists, closing: ${currentContextId}`
        );
        closeContext(currentContextId);
      }

      // 3️⃣ Check ElevenLabs status before starting new context
      const elevenStatus = getElevenLabsStatus();
      logger.info(
        `📊 [ELEVEN STATUS] connected=${elevenStatus.connected}, ready=${elevenStatus.ready}, wsState=${elevenStatus.wsState}`
      );

      if (!elevenStatus.ready) {
        logger.error(
          `❌ [RESPONSE START] ElevenLabs not ready! Cannot start context.`
        );
        socket.emit("ai-error", { message: "TTS service not ready" });
        return;
      }

      // 4️⃣ Start new ElevenLabs context
      logger.info(
        `🆕 [ELEVEN] Starting new context for Socket ${socket.id}...`
      );
      currentContextId = startContext(socket);

      if (!currentContextId) {
        logger.error(
          `❌ [RESPONSE START] FATAL: Could not start ElevenLabs context | Socket: ${socket.id}`
        );
        socket.emit("ai-error", { message: "TTS context creation failed" });
      } else {
        isContextClosing = false;
        logger.info(
          `✅ [RESPONSE START] New context created: ${currentContextId} | Socket: ${socket.id}`
        );
      }
    }

    // ------------------------------------------------------------------------
    // TEXT DELTA: Stream text chunks to ElevenLabs
    // ------------------------------------------------------------------------
    if (event.type === "response.output_text.delta") {
      const textChunk = event.delta;
      textChunkCount++;

      logger.info(
        `📝 [TEXT CHUNK #${textChunkCount}] Length: ${textChunk.length} | Context: ${currentContextId} | Socket: ${socket.id}`
      );
      logger.info(
        `📝 [TEXT CHUNK CONTENT] "${textChunk.substring(0, 50)}${
          textChunk.length > 50 ? "..." : ""
        }"`
      );

      if (!currentContextId) {
        logger.error(
          `❌ [TEXT CHUNK #${textChunkCount}] No contextId! Cannot send to ElevenLabs`
        );
        return;
      }

      if (isContextClosing) {
        logger.warn(
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

      logger.info(
        `📤 [BE->ELEVEN] Sending text chunk #${textChunkCount} to context ${currentContextId}`
      );
      const sendResult = sendTextToElevenLabs(textChunk, currentContextId);
      logger.info(`📤 [BE->ELEVEN] Send result: ${sendResult}`);
    }

    // ------------------------------------------------------------------------
    // TEXT DONE: GPT finished generating text
    // ------------------------------------------------------------------------
    if (event.type === "response.output_text.done") {
      const fullAiResponse = event.text;
      logger.info(
        `🤖 [AI RESPONSE COMPLETE] Socket ${socket.id} | Total chunks: ${textChunkCount}`
      );
      logger.info(
        `🤖 [AI RESPONSE TEXT] "${fullAiResponse.substring(0, 100)}${
          fullAiResponse.length > 100 ? "..." : ""
        }"`
      );

      // Send transcript to frontend
      logger.info(
        `📤 [BE->FE] Emitting 'ai-transcript' to Socket ${socket.id}`
      );
      socket.emit("ai-transcript", {
        text: fullAiResponse,
        timestamp: new Date().toISOString(),
      });

      // Flush ElevenLabs buffer
      if (currentContextId && !isContextClosing) {
        logger.info(
          `🚰 [FLUSH] Flushing ElevenLabs buffer for context ${currentContextId}`
        );
        const flushResult = sendTextToElevenLabs("", currentContextId, {
          flush: true,
        });
        logger.info(`🚰 [FLUSH] Flush result: ${flushResult}`);
        logger.info(
          `⏳ [AUDIO WAIT] Context ${currentContextId} remains open, waiting for audio completion...`
        );
      } else {
        logger.warn(
          `⚠️ [FLUSH] Cannot flush | contextId=${currentContextId}, closing=${isContextClosing}`
        );
      }
    }

    // ------------------------------------------------------------------------
    // RESPONSE DONE: Overall GPT response complete
    // ------------------------------------------------------------------------
    if (event.type === "response.done") {
      logger.info(
        `✅ [GPT COMPLETE] Response done | Socket: ${socket.id} | ResponseId: ${currentResponseId}`
      );
      logger.info(
        `📤 [BE->FE] Emitting 'ai-response-done' to Socket ${socket.id}`
      );

      socket.emit("ai-response-done", { response: event.response });
      currentResponseId = null;
    }

    // ------------------------------------------------------------------------
    // RESPONSE CANCELLED: Cancellation confirmed
    // ------------------------------------------------------------------------
    if (event.type === "response.cancelled") {
      logger.info(
        `✅ [GPT CANCELLED] Response cancelled successfully | Socket: ${socket.id}`
      );
      currentResponseId = null;
      textChunkCount = 0;
      audioChunkCount = 0;
    }
  });

  // ============================================================================
  // SOCKET EVENT HANDLERS
  // ============================================================================

  // ------------------------------------------------------------------------
  // AUDIO CHUNK: Forward user audio to GPT
  // ------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------
  // AUDIO COMPLETE: ElevenLabs finished playing audio
  // ------------------------------------------------------------------------
  socket.on("ai-audio-complete", ({ contextId }) => {
    logger.info(
      `🔊 [AUDIO COMPLETE] Received from frontend | contextId: ${contextId} | Socket: ${socket.id}`
    );
    logger.info(
      `📊 [STATE CHECK] currentContextId: ${currentContextId}, match: ${
        contextId === currentContextId
      }`
    );

    if (contextId === currentContextId) {
      logger.info(
        `✅ [CLEANUP] Audio playback complete, cleaning up context ${contextId}`
      );

      // Close the context now that audio is done
      const closeResult = closeContext(contextId);
      logger.info(`🧹 [CLEANUP] Context close result: ${closeResult}`);

      currentContextId = null;
      isContextClosing = false;
      textChunkCount = 0;
      audioChunkCount = 0;

      logger.info(`🔄 [STATE] State reset after audio completion`);
    } else {
      logger.warn(
        `⚠️ [AUDIO COMPLETE] Context mismatch! Received: ${contextId}, Current: ${currentContextId}`
      );
    }
  });

  // ------------------------------------------------------------------------
  // DISCONNECT: Clean up when client disconnects
  // ------------------------------------------------------------------------
  socket.on("disconnect", () => {
    logger.info(`🔴 [DISCONNECT] Client disconnected | Socket: ${socket.id}`);
    logger.info(
      `📊 [DISCONNECT STATE] contextId: ${currentContextId}, responseId: ${currentResponseId}`
    );

    // Clean up timer
    if (contextCleanupTimer) {
      clearTimeout(contextCleanupTimer);
      logger.info(`⏳ [DISCONNECT] Cleanup timer canceled`);
    }

    // Close current context if exists
    if (currentContextId) {
      logger.info(`🧹 [DISCONNECT] Closing context: ${currentContextId}`);
      const closeResult = closeContext(currentContextId);
      logger.info(`🧹 [DISCONNECT] Context close result: ${closeResult}`);
    }

    // Close GPT WebSocket
    if (gptWs) {
      logger.info(`🔌 [DISCONNECT] Closing GPT WebSocket`);
      gptWs.close();
    }

    // Log final status
    const elevenStatus = getElevenLabsStatus();
    logger.info(
      `📊 [DISCONNECT FINAL] ElevenLabs status: connected=${elevenStatus.connected}, activeContexts=${elevenStatus.activeContexts.length}`
    );

    logger.info(`👋 [DISCONNECT] Cleanup complete for Socket ${socket.id}`);
  });

  // Log successful setup
  logger.info(
    `✅ [SETUP COMPLETE] All handlers registered for Socket ${socket.id}`
  );
}
