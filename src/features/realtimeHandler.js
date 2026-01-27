import { connectToRealtimeAPI } from "../services/realtimeService.js";
import logger from "../utils/logger.js";
import {
  initElevenLabsForUser,
  getConnectionForUser,
  cleanupUserConnection,
} from "../services/elevenlabWS.js";
import {
  initSession,
  destroySession,
  markUserAudio,
  markUserSpeaking,
  markAiPlaybackDone,
  markReengagementTriggered,
  sessions,
} from "../services/reengagementEngine.js";
import prisma from "../lib/db.js";
import { ingestConversationMessage } from "../utils/ingestConversationMessage.js";
import { flushConversationToMemory } from "../services/flushConversationToMemory.js";
import { getVoiceConfigForToken } from "../utils/getVoiceConfigForToken.js";

export async function handleRealtimeAI(socket, token) {
  let gptWs;
  let elevenConnection = null;
  let currentResponseId = null;
  let textChunkCount = 0;
  let lastProcessedContextId = null;

  const userId = socket.id; // Use socket.id as unique user identifier

  initSession(userId);

  const voiceConfig = await getVoiceConfigForToken(token);

  try {
    // 🔥 STEP 1: Initialize ElevenLabs for THIS user
    // TODO: Get voiceId from user preferences/token

    const voiceId = voiceConfig.voiceId; // Replace with dynamic voiceId from user config

    elevenConnection = await initElevenLabsForUser(userId, voiceId, socket);
    logger.info(`✅ [${userId}] ElevenLabs initialized`);

    // 🔥 STEP 2: Load memory
    const memory = await prisma.memorySummary.findUnique({
      where: { token },
      include: { summary: true },
    });
    const summary = memory?.summary || [];

    // 🔥 STEP 3: Connect to GPT Realtime API
    gptWs = await connectToRealtimeAPI(summary, token);
    logger.info(`✅ [${userId}] GPT Realtime connected`);
  } catch (err) {
    logger.error(`❌ [${userId}] Initialization failed:`, err);
    socket.emit("ai-error", {
      message: "AI connection failed: " + err.message,
    });

    // Cleanup on error
    if (elevenConnection) {
      cleanupUserConnection(userId);
    }
    return;
  }

  socket.on("conversation-started", () => {
    const s = sessions.get(userId);
    if (!s) return;

    s.conversationActive = true;
    s.lastUserAudioAt = Date.now();
    s.lastAiPlaybackFinishedAt = Date.now();
    s.cooldownUntil = Date.now() + 5000;
  });

  socket.on("trigger-reengagement", () => {
    markReengagementTriggered(userId);

    gptWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions:
            "The user has been quiet. Say a short, friendly re-engagement sentence in the language user is talking. Be warm and natural. Do not ask multiple questions.",
          output_modalities: ["text"],
        },
      }),
    );
  });

  gptWs.on("message", async (msg) => {
    const event = JSON.parse(msg.toString());

    // 🎤 User started speaking - interrupt AI
    if (event.type === "input_audio_buffer.speech_started") {
      const connection = getConnectionForUser(userId);

      // 🔥 CRITICAL: Mark user activity IMMEDIATELY to prevent re-engagement
      markUserSpeaking(userId, true);
      logger.info(`🎤 [${userId}] User started speaking - activity updated`);

      if (connection && connection.contextId) {
        logger.info(`🛑 [${userId}] User interrupted - canceling AI response`);

        // Notify frontend
        socket.emit("ai-interrupt");

        // Cancel GPT response
        if (currentResponseId) {
          gptWs.send(JSON.stringify({ type: "response.cancel" }));
        }

        // Close ElevenLabs context
        connection.closeContext();

        // Reset state
        currentResponseId = null;
        textChunkCount = 0;
      }
    }

    // 🛑 User stopped speaking
    if (event.type === "input_audio_buffer.speech_stopped") {
      markUserSpeaking(userId, false);
      logger.info(`🛑 [${userId}] User stopped speaking`);
    }

    // 📝 User speech transcription completed
    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      const userTranscript = event.transcript;
      markUserAudio(userId);

      const s = sessions.get(userId);
      if (s) {
        s.cooldownUntil = 0;
      }

      await ingestConversationMessage({
        token: token,
        role: "user",
        text: userTranscript,
      });
    }

    // 🤖 AI response started
    if (event.type === "response.created") {
      currentResponseId = event.response?.id;
      textChunkCount = 0;

      const connection = getConnectionForUser(userId);

      if (!connection) {
        logger.error(`❌ [${userId}] No ElevenLabs connection found`);
        socket.emit("ai-error", { message: "Audio service disconnected" });
        return;
      }

      // 🔥 FIX: Only close old context if it's different from current
      const oldContextId = connection.contextId;

      if (oldContextId) {
        logger.info(
          `🔄 [${userId}] Closing old context ${oldContextId} before starting new one`,
        );
        connection.closeContext();
      }
      // Start new context
      const newContextId = connection.startContext(voiceConfig);

      if (!newContextId) {
        logger.error(`❌ [${userId}] Failed to start audio context`);
        socket.emit("ai-error", { message: "Failed to start audio stream" });
      }
    }

    // 📤 AI text chunk received
    if (event.type === "response.output_text.delta") {
      const textChunk = event.delta;
      textChunkCount++;

      const connection = getConnectionForUser(userId);

      if (!connection) {
        logger.error(
          `❌ [${userId}] No connection for text chunk #${textChunkCount}`,
        );
        return;
      }

      if (!connection.contextId) {
        logger.error(`❌Cannot send text - no active context`);

        return;
      }

      const sendResult = connection.sendText(textChunk);

      if (!sendResult) {
        logger.error(
          `❌ [${userId}] Failed to send text chunk #${textChunkCount}`,
        );
      }
    }

    // ✅ AI text generation complete
    if (event.type === "response.output_text.done") {
      const fullAiResponse = event.text;

      await ingestConversationMessage({
        token,
        role: "ai",
        text: fullAiResponse,
      });

      const connection = getConnectionForUser(userId);

      if (connection && connection.contextId) {
        // Flush remaining audio
        connection.sendText("", { flush: true });
      }
    }

    // ✅ AI response done
    if (event.type === "response.done") {
      socket.emit("ai-response-done", { response: event.response });
      currentResponseId = null;
    }

    // ❌ AI response cancelled
    if (event.type === "response.cancelled") {
      currentResponseId = null;
      textChunkCount = 0;
    }
  });

  // 🎤 User audio chunk from frontend
  socket.on("audio-chunk", (chunkArrayBuffer) => {
    try {
      const base64Audio = Buffer.from(chunkArrayBuffer).toString("base64");

      gptWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        }),
      );
    } catch (err) {
      logger.error(`❌ [${userId}] Error forwarding audio to GPT:`, err);
    }
  });

  // 🔊 Frontend finished playing audio
  socket.on("ai-audio-done", ({ contextId }) => {
    logger.info(
      `🔊 [${userId}] Frontend confirmed playback done at ${new Date().toISOString()}`,
    );

    // 🔥 FIX: Prevent duplicate processing of same contextId
    if (lastProcessedContextId === contextId) {
      logger.warn(
        `⚠️ [${userId}] Duplicate ai-audio-done for context ${contextId}, ignoring`,
      );
      return;
    }

    lastProcessedContextId = contextId;

    const connection = getConnectionForUser(userId);

    if (!connection) {
      logger.warn(`⚠️ [${userId}] No connection found for audio-done event`);
      return;
    }

    if (contextId !== connection.contextId) {
      logger.warn(
        `⚠️ [${userId}] Context mismatch. Received=${contextId}, Active=${connection.contextId}`,
      );
    }

    // Close context only if it matches
    if (contextId === connection.contextId) {
      connection.closeContext();
    }

    // Reset state
    textChunkCount = 0;

    markAiPlaybackDone(userId);
    logger.info(
      `✅ [${userId}] Playback marked as done. Re-engagement timer starts NOW.`,
    );
  });

  // 🔌 User disconnected
  socket.on("disconnect", async () => {
    logger.info(`🔴 [${userId}] User disconnecting...`);

    try {
      // Flush conversation to memory
      await flushConversationToMemory(token);
      logger.info(`✅ [${userId}] Memory flushed`);
    } catch (err) {
      logger.error(`❌ [${userId}] Memory flush failed:`, err);
    }

    // Destroy session
    destroySession(userId);

    // 🔥 FIX: Clean up THIS user's ElevenLabs connection
    cleanupUserConnection(userId);
    logger.info(`✅ [${userId}] ElevenLabs connection cleaned up`);

    // Close GPT WebSocket
    if (gptWs) {
      gptWs.close();
      logger.info(`✅ [${userId}] GPT connection closed`);
    }

    logger.info(`✅ [${userId}] Full cleanup complete`);
  });
}
