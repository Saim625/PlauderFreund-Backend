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
  registerReengagementTrigger,
  setReengagementEnabled,
  sessions,
} from "../services/reengagementEngine.js";
import { resolveUserTimezone } from "../utils/resolveUserTimezone.js";
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
import {
  createWebRtcSession,
  destroyWebRtcSession,
  getWebRtcSession,
  registerWebRtcSocketHandlers,
} from "../services/webrtcService.js";
import { createTtsAudioTransport } from "../services/ttsAudioTransport.js";

export async function handleRealtimeAI(socket, token, timezone, options = {}) {
  const { deferConversationStart = false } = options;
  /* -------------------------------------------------------------------------- */
  /*                                  STATE                                     */
  /* -------------------------------------------------------------------------- */

  let gptWs;
  let elevenConnection = null;
  let ttsAudioTransport = null;
  let currentResponseId = null;
  let textChunkCount = 0;
  let lastProcessedContextId = null;
  let voiceConfig;
  let ttsTextBuffer = "";
  let ttsPhraseTimer = null;

  // Let ElevenLabs see a short phrase rather than individual model tokens.
  // This preserves natural prosody while adding at most this much first-audio
  // latency when no punctuation is available yet.
  const TTS_PHRASE_WAIT_MS = 180;
  const TTS_MIN_TIMED_PHRASE_CHARS = 20;
  const TTS_MAX_PHRASE_CHARS = 90;

  let userMessageCount = 0;
  const REMINDER_TRIGGER_AFTER_MESSAGES = 3;

  let gptReconnectAttempts = 0;
  const GPT_MAX_RECONNECT = 5;

  const sessionId = socket.id;
  const sessionStartedAt = new Date();
  const isTelephony = sessionId.startsWith("telephony_");

  initSession(sessionId);

  const resolvedTimezone = await resolveUserTimezone(token, timezone, {
    telephony: isTelephony,
  });
  const getTimezone = () => resolvedTimezone;

  /* -------------------------------------------------------------------------- */
  /*                              HELPER FUNCTIONS                              */
  /* -------------------------------------------------------------------------- */

  function appendAudioToGptBase64(base64Pcm) {
    try {
      if (!gptWs) return;
      // ws (node) uses numeric readyState; 1 is OPEN in both browser and ws.
      if (gptWs.readyState !== 1) return;

      gptWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Pcm,
        }),
      );
    } catch (err) {
      logger.error(`❌ [${sessionId}] Error forwarding audio to GPT:`, err);
    }
  }

  function clearTtsPhraseTimer() {
    if (!ttsPhraseTimer) return;
    clearTimeout(ttsPhraseTimer);
    ttsPhraseTimer = null;
  }

  function resetTtsPhraseBuffer() {
    clearTtsPhraseTimer();
    ttsTextBuffer = "";
  }

  function nextTtsPhrase({ force = false, timed = false } = {}) {
    if (!ttsTextBuffer) return null;
    if (force) {
      const phrase = ttsTextBuffer;
      ttsTextBuffer = "";
      return phrase;
    }

    // Prefer a sentence or clause boundary. The whitespace is retained so
    // ElevenLabs receives naturally separated words.
    const boundary = /[.!?;:](?:\s|$)/.exec(ttsTextBuffer);
    if (boundary) {
      const end = boundary.index + boundary[0].length;
      const phrase = ttsTextBuffer.slice(0, end);
      ttsTextBuffer = ttsTextBuffer.slice(end);
      return phrase;
    }

    // A comma is useful once we have enough context for natural phrasing.
    if (ttsTextBuffer.length >= TTS_MIN_TIMED_PHRASE_CHARS) {
      const comma = ttsTextBuffer.lastIndexOf(",");
      if (comma >= TTS_MIN_TIMED_PHRASE_CHARS - 1) {
        const phrase = ttsTextBuffer.slice(0, comma + 1);
        ttsTextBuffer = ttsTextBuffer.slice(comma + 1);
        return phrase;
      }
    }

    // Keep response latency bounded even if the model has not emitted
    // punctuation. Never split in the middle of a word.
    const shouldSplit =
      ttsTextBuffer.length >= TTS_MAX_PHRASE_CHARS ||
      (timed && ttsTextBuffer.length >= TTS_MIN_TIMED_PHRASE_CHARS);
    if (!shouldSplit) return null;

    const limit = Math.min(ttsTextBuffer.length, TTS_MAX_PHRASE_CHARS);
    const splitAt = ttsTextBuffer.lastIndexOf(" ", limit);
    if (splitAt <= 0) return null;

    const phrase = ttsTextBuffer.slice(0, splitAt + 1);
    ttsTextBuffer = ttsTextBuffer.slice(splitAt + 1);
    return phrase;
  }

  function flushTtsPhrases({ keepTimer = false, ...options } = {}) {
    if (!keepTimer) clearTtsPhraseTimer();

    const connection = getConnectionForUser(sessionId);
    if (!connection?.contextId) return false;

    let sentAny = false;
    let phrase;
    while ((phrase = nextTtsPhrase(options))) {
      const sendResult = connection.sendText(phrase);
      if (!sendResult) {
        logger.error(`❌ [${sessionId}] Failed to send buffered TTS phrase`);
        return sentAny;
      }
      addRealtimeAudioChars(sessionId, phrase.length);
      sentAny = true;
    }
    return sentAny;
  }

  function scheduleTtsPhraseFlush() {
    if (ttsPhraseTimer || !ttsTextBuffer) return;
    ttsPhraseTimer = setTimeout(() => {
      ttsPhraseTimer = null;
      flushTtsPhrases({ timed: true });
      if (ttsTextBuffer) scheduleTtsPhraseFlush();
    }, TTS_PHRASE_WAIT_MS);
  }

  async function loadMemoryAndSummaries() {
    const memory = await prisma.memorySummary.findUnique({
      where: { token },
      include: { summary: true },
    });

    const summary = memory?.summary || [];

    const previousSummaries = await prisma.conversationSummary.findMany({
      where: { userToken: token },
      orderBy: { sessionAt: "desc" },
      take: 2,
    });

    let summaryText = "";

    if (previousSummaries.length > 0) {
      summaryText = previousSummaries
        .map(
          (s, i) =>
            `Session ${i === 0 ? "last" : "2 sessions ago"}: ${s.summary}`,
        )
        .join("\n\n");
    }

    return {
      summary,
      summaryText,
    };
  }

  async function connectGPT() {
    const { summary, summaryText } = await loadMemoryAndSummaries();

    gptWs = await connectToRealtimeAPI(
      summary,
      summaryText,
      token,
      getTimezone(),
      { channel: isTelephony ? "telephony" : "web" },
    );

    socket.data = socket.data || {};
    socket.data.gptWs = gptWs;

    attachGPTListeners();
  }

  async function reconnectGPT() {
    if (gptReconnectAttempts >= GPT_MAX_RECONNECT) {
      logger.error(`❌ [${sessionId}] GPT max reconnect attempts reached`);

      socket.emit("ai-error", {
        message: "AI connection lost. Please refresh.",
      });

      return;
    }

    gptReconnectAttempts++;

    const delay = Math.min(1000 * Math.pow(2, gptReconnectAttempts - 1), 10000);

    logger.info(
      `🔄 [${sessionId}] GPT reconnecting in ${delay}ms (attempt ${gptReconnectAttempts}/${GPT_MAX_RECONNECT})`,
    );

    await new Promise((res) => setTimeout(res, delay));

    try {
      await connectGPT();

      gptReconnectAttempts = 0;

      logger.info(`✅ [${sessionId}] GPT reconnected successfully`);
    } catch (err) {
      logger.error(`❌ [${sessionId}] GPT reconnect failed:`, err.message);

      reconnectGPT();
    }
  }

  function attachGPTListeners() {
    if (!gptWs) return;

    gptWs.on("message", async (msg) => {
      let event;

      try {
        event = JSON.parse(msg.toString());
      } catch (err) {
        logger.error(`❌ [${sessionId}] Failed to parse GPT message`, err);
        return;
      }

      /* ---------------------------------------------------------------------- */
      /*                        USER STARTED SPEAKING                            */
      /* ---------------------------------------------------------------------- */

      if (event.type === "input_audio_buffer.speech_started") {
        const connection = getConnectionForUser(sessionId);

        markUserSpeaking(sessionId, true);

        logger.info(
          `🎤 [${sessionId}] User started speaking - activity updated`,
        );

        if (connection && connection.contextId) {
          logger.info(
            `🛑 [${sessionId}] User interrupted - canceling AI response`,
          );

          socket.emit("ai-interrupt");
          ttsAudioTransport?.interrupt();
          resetTtsPhraseBuffer();

          if (currentResponseId) {
            gptWs.send(JSON.stringify({ type: "response.cancel" }));
          }

          connection.closeContext();

          currentResponseId = null;
          textChunkCount = 0;
        }
      }

      /* ---------------------------------------------------------------------- */
      /*                         USER STOPPED SPEAKING                           */
      /* ---------------------------------------------------------------------- */

      if (event.type === "input_audio_buffer.speech_stopped") {
        markUserSpeaking(sessionId, false);

        logger.info(`🛑 [${sessionId}] User stopped speaking`);
      }

      /* ---------------------------------------------------------------------- */
      /*                          USER TRANSCRIPTION                             */
      /* ---------------------------------------------------------------------- */

      if (
        event.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const userTranscript = event.transcript;

        markUserAudio(sessionId);

        userMessageCount++;

        if (userMessageCount === REMINDER_TRIGGER_AFTER_MESSAGES) {
          await enqueueDueRemindersForSession(token, sessionId, gptWs);

          logger.info(`🔔 [${sessionId}] Reminder queue triggered`);
        }

        const s = sessions.get(sessionId);

        if (s) {
          s.cooldownUntil = 0;
        }

        await ingestConversationMessage({
          token,
          role: "user",
          text: userTranscript,
        });

        const wordCount = (userTranscript || "").trim().split(/\s+/).length;

        const estimatedSeconds = Math.max(1, Math.round(wordCount * 0.46));

        addWhisperSeconds(sessionId, estimatedSeconds);
      }

      /* ---------------------------------------------------------------------- */
      /*                           AI RESPONSE CREATED                           */
      /* ---------------------------------------------------------------------- */

      if (event.type === "response.created") {
        currentResponseId = event.response?.id;
        textChunkCount = 0;
        resetTtsPhraseBuffer();

        const connection = getConnectionForUser(sessionId);

        if (!connection) {
          logger.error(`❌ [${sessionId}] No ElevenLabs connection found`);

          socket.emit("ai-error", {
            message: "Audio service disconnected",
          });

          return;
        }

        const oldContextId = connection.contextId;

        if (oldContextId) {
          logger.info(
            `🔄 [${sessionId}] Closing old context ${oldContextId} before starting new one`,
          );

          connection.closeContext();
        }

        const newContextId = connection.startContext(voiceConfig);

        if (!newContextId) {
          logger.error(`❌ [${sessionId}] Failed to start audio context`);

          socket.emit("ai-error", {
            message: "Failed to start audio stream",
          });
        }
      }

      /* ---------------------------------------------------------------------- */
      /*                            STREAM AI TEXT                               */
      /* ---------------------------------------------------------------------- */

      if (event.type === "response.output_text.delta") {
        const textChunk = event.delta;

        textChunkCount++;
        if (!textChunk) return;

        ttsTextBuffer += textChunk;
        // Keep an already-running timer: this is a maximum wait from the
        // first token, not a debounce that can delay speech indefinitely.
        flushTtsPhrases({ keepTimer: true });
        if (ttsTextBuffer) scheduleTtsPhraseFlush();
      }

      /* ---------------------------------------------------------------------- */
      /*                           AI TEXT COMPLETE                              */
      /* ---------------------------------------------------------------------- */

      if (event.type === "response.output_text.done") {
        const fullAiResponse = event.text;

        await ingestConversationMessage({
          token,
          role: "ai",
          text: fullAiResponse,
        });

        const connection = getConnectionForUser(sessionId);

        if (connection && connection.contextId) {
          flushTtsPhrases({ force: true });
          connection.sendText("", { flush: true });
        }
      }

      /* ---------------------------------------------------------------------- */
      /*                             RESPONSE DONE                               */
      /* ---------------------------------------------------------------------- */

      if (event.type === "response.done") {
        socket.emit("ai-response-done", {
          response: event.response,
        });

        currentResponseId = null;

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

      /* ---------------------------------------------------------------------- */
      /*                          RESPONSE CANCELLED                             */
      /* ---------------------------------------------------------------------- */

      if (event.type === "response.cancelled") {
        currentResponseId = null;
        textChunkCount = 0;
        resetTtsPhraseBuffer();
      }

      /* ---------------------------------------------------------------------- */
      /*                               TOOL CALLS                                */
      /* ---------------------------------------------------------------------- */

      if (event.type === "response.function_call_arguments.done") {
        try {
          await handleToolCall(event, sessionId, token, gptWs, getTimezone());

          logger.info(`🛠️ [${sessionId}] Tool call handled successfully`);
        } catch (err) {
          logger.error(`❌ [${sessionId}] Tool call failed:`, err);
        }
      }
    });

    gptWs.on("close", (code, reason) => {
      logger.warn(
        `⚠️ [${sessionId}] GPT WebSocket closed. Code: ${code}, Reason: ${reason}`,
      );

      if (!socket.connected) {
        logger.info(
          `ℹ️ [${sessionId}] Socket disconnected — skipping GPT reconnect`,
        );

        return;
      }

      if (code === 1000) {
        logger.info(`ℹ️ [${sessionId}] GPT closed normally — no reconnect`);
        return;
      }

      reconnectGPT();
    });

    gptWs.on("error", (err) => {
      logger.error(`❌ [${sessionId}] GPT WebSocket error:`, err.message);
    });
  }

  async function saveUsageAndCosts() {
    const config = await prisma.personalityConfig.findUnique({
      where: { userToken: token },
    });

    const realtimeModel = config?.realtimeModel || "gpt-realtime-mini";
    const chatModel = config?.chatModel || "gpt-4o-mini";

    const endedAt = new Date();
    const durationSeconds = Math.round((endedAt - sessionStartedAt) / 1000);

    const usage = getSessionUsage(sessionId);

    if (!usage) {
      logger.warn(`⚠️ [${sessionId}] usage is NULL — initSessionUsage missing`);

      return;
    }

    logger.info(`🔍 [${sessionId}] Calculating costs...`);

    const result = await calculateSessionCost(usage, realtimeModel, chatModel);

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
        realtimeCachedAudioInputTokens: usage.realtimeCachedAudioInputTokens,
        realtimeOutputTokens: usage.realtimeOutputTokens,

        whisperSeconds: usage.whisperSeconds,

        chatInputTokens: usage.chatInputTokens,
        chatOutputTokens: usage.chatOutputTokens,

        realtimeAudioChars: usage.realtimeAudioChars,
        greetingAudioChars: usage.greetingAudioChars,

        realtimeGptCost: costs.realtimeGptCost,
        chatGptCost: costs.chatGptCost,
        elevenlabsCost: costs.elevenlabsCost,
        totalCost: costs.totalCost,

        realtimeModelUsed: realtimeModel,
        chatModelUsed: chatModel,
      },
    });

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

        totalWhisperSeconds: {
          increment: usage.whisperSeconds,
        },

        totalChatInputTokens: {
          increment: usage.chatInputTokens,
        },

        totalChatOutputTokens: {
          increment: usage.chatOutputTokens,
        },

        totalRealtimeAudioChars: {
          increment: usage.realtimeAudioChars,
        },

        totalGreetingAudioChars: {
          increment: usage.greetingAudioChars,
        },

        totalCost: {
          increment: costs.totalCost,
        },
      },
    });

    logger.info(
      `✅ [${sessionId}] Session usage saved — total cost: $${costs.totalCost.toFixed(6)}`,
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                                INITIALIZE                                  */
  /* -------------------------------------------------------------------------- */

  try {
    voiceConfig = await getVoiceConfigForToken(token);
    if (isTelephony) {
      voiceConfig = {
        ...voiceConfig,
        telephonyOptimized: true,
      };
    }

    const personalityConfig = await prisma.personalityConfig.findUnique({
      where: { userToken: token },
    });
    setReengagementEnabled(
      sessionId,
      personalityConfig?.reengageAfterSilence !== false,
    );

    ttsAudioTransport = createTtsAudioTransport(sessionId, socket);

    elevenConnection = await initElevenLabsForUser(
      sessionId,
      voiceConfig.voiceId,
      {
        socket,
        audioTransport: ttsAudioTransport,
        // Browser playback expects PCM 24 kHz. Asterisk expects μ-law 8 kHz,
        // so calls receive the telephony codec directly from ElevenLabs.
        outputFormat: isTelephony ? "ulaw_8000" : "pcm_24000",
      },
    );

    logger.info(`✅ [${sessionId}] ElevenLabs initialized`);

    await connectGPT();

    logger.info(`✅ [${sessionId}] GPT connected`);

    initSessionUsage(sessionId);

    const isTelephonySession = sessionId.startsWith("telephony_");

    // WebRTC is browser-only; telephony uses the RTP adapter path.
    if (!isTelephonySession) {
      createWebRtcSession(socket, sessionId, {
        onAudioBase64: appendAudioToGptBase64,
      });
      registerWebRtcSocketHandlers(socket, sessionId);
    }
  } catch (err) {
    logger.error(`❌ [${sessionId}] Initialization failed:`, err);

    socket.emit("ai-error", {
      message: `AI connection failed: ${err.message}`,
    });

    if (elevenConnection) {
      cleanupUserConnection(sessionId);
    }

    return;
  }

  /* -------------------------------------------------------------------------- */
  /*                               SOCKET EVENTS                                */
  /* -------------------------------------------------------------------------- */

  async function executeReengagement() {
    if (!gptWs || gptWs.readyState !== 1) {
      logger.warn(`⚠️ [${sessionId}] Re-engagement skipped — GPT not ready`);
      return;
    }

    markReengagementTriggered(sessionId);

    try {
      await maybeInjectNextReminder(sessionId, token, gptWs);
    } catch (err) {
      logger.error(`❌ [${sessionId}] Reminder injection failed:`, err);
    }

    gptWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions:
            "The user has been quiet for a while. Continue the SAME ongoing conversation — do NOT greet again, do not re-introduce yourself, and do not repeat the opening greeting. Say one short, warm check-in in the user's language. One sentence only, at most one simple question.",
          output_modalities: ["text"],
        },
      }),
    );
  }

  socket.on("trigger-reengagement", executeReengagement);

  if (isTelephony) {
    registerReengagementTrigger(sessionId, () => {
      executeReengagement().catch((err) => {
        logger.error(`❌ [${sessionId}] Telephony re-engagement failed:`, err);
      });
    });
  }

  socket.on("conversation-started", () => {
    const s = sessions.get(sessionId);

    if (!s) return;

    s.conversationActive = true;
    s.lastUserAudioAt = Date.now();
    s.lastAiPlaybackFinishedAt = Date.now();
    s.cooldownUntil = Date.now() + 5000;
  });

  socket.on("audio-chunk", (chunk) => {
    try {
      const webrtc = getWebRtcSession(sessionId);
      if (webrtc?.useWebRtcAudio) {
        return;
      }

      const base64Audio =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString("base64");

      appendAudioToGptBase64(base64Audio);
    } catch (err) {
      logger.error(`❌ [${sessionId}] Error forwarding audio to GPT:`, err);
    }
  });

  socket.on("ai-audio-done", ({ contextId }) => {
    logger.info(
      `🔊 [${sessionId}] Frontend confirmed playback done at ${new Date().toISOString()}`,
    );

    if (lastProcessedContextId === contextId) {
      logger.warn(
        `⚠️ [${sessionId}] Duplicate ai-audio-done for context ${contextId}`,
      );

      return;
    }

    lastProcessedContextId = contextId;

    const connection = getConnectionForUser(sessionId);

    if (!connection) {
      logger.warn(`⚠️ [${sessionId}] No connection found for audio-done`);
      return;
    }

    if (contextId !== connection.contextId) {
      logger.warn(
        `⚠️ [${sessionId}] Context mismatch. Received=${contextId}, Active=${connection.contextId}`,
      );
    }

    if (contextId === connection.contextId) {
      connection.closeContext();
    }

    textChunkCount = 0;

    markAiPlaybackDone(sessionId);

    logger.info(
      `✅ [${sessionId}] Playback marked as done. Re-engagement timer starts now.`,
    );
  });

  socket.on("disconnect", async () => {
    logger.info(`🔌 [${sessionId}] User disconnected`);
    resetTtsPhraseBuffer();

    try {
      await prisma.userAccessToken.update({
        where: { token },
        data: {
          lastActiveAt: new Date(),
        },
      });
    } catch (err) {
      logger.warn(
        `⚠️ [${sessionId}] lastActiveAt update skipped: ${err.message}`,
      );
    }

    try {
      await flushConversationToMemory(
        token,
        getTimezone(),
        sessionId,
        "gpt-4o-mini",
      );
    } catch (err) {
      logger.error(`❌ [${sessionId}] Memory flush failed:`, err);
    }

    try {
      await saveUsageAndCosts();
    } catch (err) {
      logger.error(`❌ [${sessionId}] Usage tracking failed: ${err.message}`);
    } finally {
      clearSessionUsage(sessionId);
    }

    destroyWebRtcSession(sessionId, "socket-disconnect");

    destroySession(sessionId);

    cleanupUserConnection(sessionId);

    logger.info(`✅ [${sessionId}] ElevenLabs connection cleaned up`);

    if (gptWs) {
      gptWs.close(1000, "Socket disconnected");

      logger.info(`✅ [${sessionId}] GPT connection closed`);
    }

    clearReminderSession(sessionId);

    logger.info(`✅ [${sessionId}] Full cleanup complete`);
  });

  if (isTelephony && !deferConversationStart) {
    socket.emit("conversation-started");
    logger.info(`📞 [${sessionId}] Telephony session marked active`);
  }
}
