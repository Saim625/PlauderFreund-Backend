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
import { handleToolCall } from "../utils/toolHandlers.js";
import {
  clearReminderSession,
  enqueueDueRemindersForSession,
  markReminderSlotFreeForNextResponse,
  maybeInjectNextReminder,
} from "../services/reminderQueue.js";
import {
  addRealtimeAudioChars,
  addRealtimeTokens,
  addWhisperSeconds,
  clearSessionUsage,
  getSessionUsage,
  initSessionUsage,
} from "../services/usageTracker.js";
import { calculateSessionCost } from "../services/costCalculator.js";

export async function handleRealtimeAI(socket, token, timezone) {
  let gptWs;
  let elevenConnection = null;
  let currentResponseId = null;
  let textChunkCount = 0;
  let lastProcessedContextId = null;

  let userMessageCount = 0;
  const REMINDER_TRIGGER_AFTER_MESSAGES = 3;

  let gptReconnectAttempts = 0;
  const GPT_MAX_RECONNECT = 5;

  const safeTimeZone = timezone && timezone !== undefined ? timezone : "UTC";

  const sessionId = socket.id; // Use socket.id as unique user identifier

  initSession(sessionId);
  const sessionStartedAt = new Date();

  const voiceConfig = await getVoiceConfigForToken(token);

  try {
    // 🔥 STEP 1: Initialize ElevenLabs for THIS user
    // TODO: Get voiceId from user preferences/token

    const voiceId = voiceConfig.voiceId; // Replace with dynamic voiceId from user config

    elevenConnection = await initElevenLabsForUser(sessionId, voiceId, socket);
    logger.info(`✅ [${sessionId}] ElevenLabs initialized`);

    // 🔥 STEP 2: Load memory
    const memory = await prisma.memorySummary.findUnique({
      where: { token },
      include: { summary: true },
    });
    const summary = memory?.summary || [];

    // step 3 Load summary of previous sessions
    let summaryText = "";

    const previousSummaries = await prisma.conversationSummary.findMany({
      where: { userToken: token },
      orderBy: { sessionAt: "desc" },
      take: 2,
    });

    if (previousSummaries.length > 0) {
      summaryText = previousSummaries
        .map(
          (s, i) =>
            `Session ${i === 0 ? "last" : "2 sessions ago"}: ${s.summary}`,
        )
        .join("\n\n");
    }

    // 🔥 STEP 4: Connect to GPT Realtime API
    gptWs = await connectToRealtimeAPI(
      summary,
      summaryText,
      token,
      safeTimeZone,
    );
    logger.info(`✅ [${sessionId}] GPT Realtime connected`);
    // ✅ NEW: Attach gptWs to socket so cron scheduler can access it mid-session
    socket.data = socket.data || {};
    socket.data.gptWs = gptWs;

    initSessionUsage(sessionId);
    logger.info(`🔍 [${sessionId}] Session usage initialized`);

    attachGPTListeners();

    async function reconnectGPT() {
      if (gptReconnectAttempts >= GPT_MAX_RECONNECT) {
        logger.error(`❌ [${sessionId}] GPT max reconnect attempts reached`);
        socket.emit("ai-error", {
          message: "AI connection lost. Please refresh.",
        });
        return;
      }

      gptReconnectAttempts++;
      const delay = Math.min(
        1000 * Math.pow(2, gptReconnectAttempts - 1),
        10000,
      );
      logger.info(
        `🔄 [${sessionId}] GPT reconnecting in ${delay}ms (attempt ${gptReconnectAttempts}/${GPT_MAX_RECONNECT})`,
      );

      await new Promise((res) => setTimeout(res, delay));

      try {
        // Reconnect GPT with same memory/config
        const memory = await prisma.memorySummary.findUnique({
          where: { token },
          include: { summary: true },
        });
        const summary = memory?.summary || [];

        gptWs = await connectToRealtimeAPI(summary, token, safeTimeZone);

        // Re-attach gptWs to socket for cron scheduler
        socket.data = socket.data || {};
        socket.data.gptWs = gptWs;

        gptReconnectAttempts = 0; // reset on success
        logger.info(`✅ [${sessionId}] GPT reconnected successfully`);

        // Re-attach all gptWs listeners by calling attachGPTListeners (see note below)
        attachGPTListeners();
      } catch (err) {
        logger.error(`❌ [${sessionId}] GPT reconnect failed:`, err.message);
        reconnectGPT(); // retry
      }
    }
  } catch (err) {
    logger.error(`❌ [${sessionId}] Initialization failed:`, err);
    socket.emit("ai-error", {
      message: "AI connection failed: " + err.message,
    });

    // Cleanup on error
    if (elevenConnection) {
      cleanupUserConnection(sessionId);
    }
    return;
  }

  socket.on("conversation-started", () => {
    const s = sessions.get(sessionId);
    if (!s) return;

    s.conversationActive = true;
    s.lastUserAudioAt = Date.now();
    s.lastAiPlaybackFinishedAt = Date.now();
    s.cooldownUntil = Date.now() + 5000;
  });

  socket.on("trigger-reengagement", async () => {
    markReengagementTriggered(sessionId);

    try {
      // If any reminders are queued, inject exactly ONE so it can be spoken
      // in this upcoming response.
      await maybeInjectNextReminder(sessionId, token, gptWs);
    } catch (err) {
      logger.error(`❌ [${sessionId}] Reminder injection failed:`, err);
    }

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

  function attachGPTListeners() {
    gptWs.on("message", async (msg) => {
      const event = JSON.parse(msg.toString());

      // 🎤 User started speaking - interrupt AI
      if (event.type === "input_audio_buffer.speech_started") {
        const connection = getConnectionForUser(sessionId);

        // 🔥 CRITICAL: Mark user activity IMMEDIATELY to prevent re-engagement
        markUserSpeaking(sessionId, true);
        logger.info(
          `🎤 [${sessionId}] User started speaking - activity updated`,
        );

        if (connection && connection.contextId) {
          logger.info(
            `🛑 [${sessionId}] User interrupted - canceling AI response`,
          );

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
        markUserSpeaking(sessionId, false);
        logger.info(`🛑 [${sessionId}] User stopped speaking`);
      }

      // 📝 User speech transcription completed
      if (
        event.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const userTranscript = event.transcript;
        markUserAudio(sessionId);

        userMessageCount++;
        if (userMessageCount === REMINDER_TRIGGER_AFTER_MESSAGES) {
          // Enqueue due reminders so we speak only ONE per assistant response
          await enqueueDueRemindersForSession(token, sessionId, gptWs);
          console.log("Reminder triggered!!!!");
        }

        const s = sessions.get(sessionId);
        if (s) {
          s.cooldownUntil = 0;
        }

        await ingestConversationMessage({
          token: token,
          role: "user",
          text: userTranscript,
        });

        const wordCount = (event.transcript || "").trim().split(/\s+/).length;
        const estimatedSeconds = Math.max(1, Math.round(wordCount * 0.46));
        addWhisperSeconds(sessionId, estimatedSeconds);
      }

      // 🤖 AI response started
      if (event.type === "response.created") {
        currentResponseId = event.response?.id;
        textChunkCount = 0;

        const connection = getConnectionForUser(sessionId);

        if (!connection) {
          logger.error(`❌ [${sessionId}] No ElevenLabs connection found`);
          socket.emit("ai-error", { message: "Audio service disconnected" });
          return;
        }

        // 🔥 FIX: Only close old context if it's different from current
        const oldContextId = connection.contextId;

        if (oldContextId) {
          logger.info(
            `🔄 [${sessionId}] Closing old context ${oldContextId} before starting new one`,
          );
          connection.closeContext();
        }
        // Start new context
        const newContextId = connection.startContext(voiceConfig);

        if (!newContextId) {
          logger.error(`❌ [${sessionId}] Failed to start audio context`);
          socket.emit("ai-error", { message: "Failed to start audio stream" });
        }
      }

      // 📤 AI text chunk received
      if (event.type === "response.output_text.delta") {
        const textChunk = event.delta;
        textChunkCount++;

        const connection = getConnectionForUser(sessionId);

        if (!connection) {
          logger.error(
            `❌ [${sessionId}] No connection for text chunk #${textChunkCount}`,
          );
          return;
        }

        if (!connection.contextId) {
          logger.error(`❌Cannot send text - no active context`);

          return;
        }

        const sendResult = connection.sendText(textChunk);

        // ✅ Track audio characters sent to ElevenLabs
        if (sendResult && textChunk) {
          addRealtimeAudioChars(sessionId, textChunk.length);
        }

        if (!sendResult) {
          logger.error(
            `❌ [${sessionId}] Failed to send text chunk #${textChunkCount}`,
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

        const connection = getConnectionForUser(sessionId);

        if (connection && connection.contextId) {
          // Flush remaining audio
          connection.sendText("", { flush: true });
        }
      }

      // ✅ AI response done
      if (event.type === "response.done") {
        socket.emit("ai-response-done", { response: event.response });
        currentResponseId = null;

        // Free the reminder slot so the next reminder (if queued) can be injected
        // on the next response opportunity.
        markReminderSlotFreeForNextResponse(sessionId);

        const usage = event.response?.usage;
        logger.info(
          `RealTime USAGE DETAILS: ${JSON.stringify(usage, null, 2)}`,
        );
        if (usage) {
          addRealtimeTokens(
            sessionId,
            usage.input_token_details || {},
            usage.output_tokens || 0,
          );
        }
      }

      // ❌ AI response cancelled
      if (event.type === "response.cancelled") {
        currentResponseId = null;
        textChunkCount = 0;
      }

      if (event.type === "response.function_call_arguments.done") {
        try {
          await handleToolCall(event, sessionId, token, gptWs, safeTimeZone);
          console.log("Handle Tool call -> Called");
        } catch (err) {
          logger.error("❌ Tool call failed:", err);
        }
      }
    });

    gptWs.on("close", (code, reason) => {
      logger.warn(
        `⚠️ [${sessionId}] GPT WebSocket closed. Code: ${code}, Reason: ${reason}`,
      );

      // Don't reconnect if socket session is already gone
      if (!socket.connected) {
        logger.info(
          `ℹ️ [${sessionId}] Socket also disconnected — skipping GPT reconnect`,
        );
        return;
      }

      // Don't reconnect on intentional close (1000 = normal closure)
      if (code === 1000) {
        logger.info(`ℹ️ [${sessionId}] GPT closed normally — no reconnect`);
        return;
      }

      reconnectGPT();
    });

    gptWs.on("error", (err) => {
      logger.error(`❌ [${sessionId}] GPT WebSocket error:`, err.message);
      // close event will fire after error — reconnect handled there
    });
  }

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
      logger.error(`❌ [${sessionId}] Error forwarding audio to GPT:`, err);
    }
  });

  // 🔊 Frontend finished playing audio
  socket.on("ai-audio-done", ({ contextId }) => {
    logger.info(
      `🔊 [${sessionId}] Frontend confirmed playback done at ${new Date().toISOString()}`,
    );

    // 🔥 FIX: Prevent duplicate processing of same contextId
    if (lastProcessedContextId === contextId) {
      logger.warn(
        `⚠️ [${sessionId}] Duplicate ai-audio-done for context ${contextId}, ignoring`,
      );
      return;
    }

    lastProcessedContextId = contextId;

    const connection = getConnectionForUser(sessionId);

    if (!connection) {
      logger.warn(`⚠️ [${sessionId}] No connection found for audio-done event`);
      return;
    }

    if (contextId !== connection.contextId) {
      logger.warn(
        `⚠️ [${sessionId}] Context mismatch. Received=${contextId}, Active=${connection.contextId}`,
      );
    }

    // Close context only if it matches
    if (contextId === connection.contextId) {
      connection.closeContext();
    }

    // Reset state
    textChunkCount = 0;

    markAiPlaybackDone(sessionId);
    logger.info(
      `✅ [${sessionId}] Playback marked as done. Re-engagement timer starts NOW.`,
    );
  });

  // 🔌 User disconnected
  socket.on("disconnect", async () => {
    logger.info(`🔴 [${sessionId}] User disconnecting...`);

    const disconnectedAt = new Date();
    try {
      await prisma.userAccessToken.update({
        where: { token },
        data: { lastActiveAt: disconnectedAt },
      });
    } catch (err) {
      logger.warn(
        `lastActiveAt update skipped [${sessionId}]: ${err?.message || err}`,
      );
    }

    try {
      // Flush conversation to memory
      await flushConversationToMemory(token, safeTimeZone, sessionId);
      logger.info(`✅ [${sessionId}] Memory flushed`);
    } catch (err) {
      logger.error(`❌ [${sessionId}] Memory flush failed:`, err);
    }
    // ✅ Finalize usage tracking and save to DB
    try {
      const endedAt = new Date();
      const durationSeconds = Math.round((endedAt - sessionStartedAt) / 1000);

      logger.info(`🔍 [${sessionId}] Looking up session usage...`);
      const usage = getSessionUsage(sessionId);
      logger.info(`🔍 [${sessionId}] Usage found: ${JSON.stringify(usage)}`);

      if (usage) {
        logger.info(`🔍 [${sessionId}] Calculating costs...`);
        const result = await calculateSessionCost(usage);
        logger.info(`🔍 [${sessionId}] Cost result: ${JSON.stringify(result)}`);

        const costs = result.success
          ? result.data
          : {
              realtimeGptCost: 0,
              chatGptCost: 0,
              elevenlabsCost: 0,
              totalCost: 0,
            };

        if (!result.success) {
          logger.error(`❌ Cost calculation failed: ${result.error}`);
        }
        logger.info(`🔍 [${sessionId}] Creating session log in DB...`);

        await prisma.sessionLog.create({
          data: {
            userToken: token,
            sessionId,
            startedAt: sessionStartedAt,
            endedAt,
            durationSeconds,
            realtimeTextInputTokens: usage.realtimeTextInputTokens,
            realtimeAudioInputTokens: usage.realtimeAudioInputTokens,
            realtimeCachedInputTokens: usage.realtimeCachedInputTokens,
            realtimeCachedAudioInputTokens:
              usage.realtimeCachedAudioInputTokens,
            realtimeOutputTokens: usage.realtimeOutputTokens,
            whisperSeconds: usage.whisperSeconds, // 👈 new
            chatInputTokens: usage.chatInputTokens,
            chatOutputTokens: usage.chatOutputTokens,
            realtimeAudioChars: usage.realtimeAudioChars,
            greetingAudioChars: usage.greetingAudioChars,
            realtimeGptCost: costs.realtimeGptCost,
            chatGptCost: costs.chatGptCost,
            elevenlabsCost: costs.elevenlabsCost,
            totalCost: costs.totalCost,
          },
        });

        logger.info(`🔍 [${sessionId}] Session log created ✅`);

        // Update user cumulative summary
        await prisma.userUsageSummary.upsert({
          where: { userToken: token },
          create: {
            userToken: token,
            totalSessions: 1,
            totalDurationSeconds: durationSeconds,
            totalRealtimeTextInputTokens: usage.realtimeTextInputTokens,
            totalRealtimeAudioInputTokens: usage.realtimeAudioInputTokens,
            totalRealtimeCachedInputTokens: usage.realtimeCachedInputTokens,
            totalRealtimeCachedAudioInputTokens:
              usage.realtimeCachedAudioInputTokens,
            totalRealtimeOutputTokens: usage.realtimeOutputTokens,
            totalWhisperSeconds: usage.whisperSeconds,
            totalChatInputTokens: usage.chatInputTokens,
            totalChatOutputTokens: usage.chatOutputTokens,
            totalRealtimeAudioChars: usage.realtimeAudioChars,
            totalGreetingAudioChars: usage.greetingAudioChars,
            totalCost: costs.totalCost,
          },
          update: {
            totalSessions: { increment: 1 },
            totalDurationSeconds: { increment: durationSeconds },
            totalRealtimeTextInputTokens: {
              increment: usage.realtimeTextInputTokens,
            },
            totalRealtimeAudioInputTokens: {
              increment: usage.realtimeAudioInputTokens,
            },
            totalRealtimeCachedInputTokens: {
              increment: usage.realtimeCachedInputTokens,
            },
            totalRealtimeCachedAudioInputTokens: {
              increment: usage.realtimeCachedAudioInputTokens,
            },
            totalRealtimeOutputTokens: {
              increment: usage.realtimeOutputTokens,
            },
            totalWhisperSeconds: { increment: usage.whisperSeconds },
            totalChatInputTokens: { increment: usage.chatInputTokens },
            totalChatOutputTokens: { increment: usage.chatOutputTokens },
            totalRealtimeAudioChars: { increment: usage.realtimeAudioChars },
            totalGreetingAudioChars: { increment: usage.greetingAudioChars },
            totalCost: { increment: costs.totalCost },
          },
        });

        logger.info(
          `✅ [${sessionId}] Session usage saved — total cost: $${costs.totalCost.toFixed(6)}`,
        );
      } else {
        logger.warn(
          `⚠️ [${sessionId}] usage is NULL — initSessionUsage was never called or wrong sessionId`,
        );
      }
    } catch (err) {
      logger.error(
        `❌ [${sessionId}] Usage tracking failed (non-fatal): ${err?.message || err}`,
      );
    } finally {
      clearSessionUsage(sessionId);
    }
    // Destroy session
    destroySession(sessionId);

    // 🔥 FIX: Clean up THIS user's ElevenLabs connection
    cleanupUserConnection(sessionId);
    logger.info(`✅ [${sessionId}] ElevenLabs connection cleaned up`);

    // Close GPT WebSocket
    if (gptWs) {
      gptWs.close();
      logger.info(`✅ [${sessionId}] GPT connection closed`);
    }

    // Cleanup reminder queue state
    clearReminderSession(sessionId);

    logger.info(`✅ [${sessionId}] Full cleanup complete`);
  });
}
