import WebSocket from "ws";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MODEL,
  ELEVENLABS_VOICE_ID,
} from "../config/env.js";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger.js";

let ws = null;
let isReady = false;
let isConnecting = false;
let reconnectTimeout = null;

const activeContexts = new Set();
const contextToSocketMap = new Map();

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const READY_TIMEOUT = 5000; // 5 seconds

/**
 * Wait for ElevenLabs WebSocket to be ready (CRITICAL FIX)
 */
export function ensureElevenLabsReady(timeout = READY_TIMEOUT) {
  logger.info(
    `⏳ [ELEVEN READY CHECK] Starting ready check | timeout: ${timeout}ms`
  );

  return new Promise((resolve, reject) => {
    // Already ready
    if (ws && ws.readyState === WebSocket.OPEN && isReady) {
      logger.info(`✅ [ELEVEN READY CHECK] Already ready!`);
      return resolve();
    }

    const startTime = Date.now();
    let checkCount = 0;

    const checkInterval = setInterval(() => {
      checkCount++;
      const elapsed = Date.now() - startTime;

      logger.info(
        `🔍 [READY CHECK #${checkCount}] wsState: ${ws?.readyState}, isReady: ${isReady}, elapsed: ${elapsed}ms`
      );

      if (ws && ws.readyState === WebSocket.OPEN && isReady) {
        clearInterval(checkInterval);
        logger.info(
          `✅ [ELEVEN READY CHECK] Ready after ${elapsed}ms (${checkCount} checks)`
        );
        resolve();
      } else if (elapsed > timeout) {
        clearInterval(checkInterval);
        logger.error(
          `❌ [ELEVEN READY CHECK] Timeout after ${elapsed}ms | wsState: ${ws?.readyState}, isReady: ${isReady}`
        );
        reject(new Error(`ElevenLabs connection timeout after ${timeout}ms`));
      }
    }, 100);
  });
}

/**
 * Initialize (or reuse) the multi-context WebSocket connection
 */
export function initElevenLabs() {
  logger.info(
    `🔌 [ELEVEN INIT] Starting initialization | Current state: wsState=${ws?.readyState}, isReady=${isReady}, isConnecting=${isConnecting}`
  );

  // Reuse existing healthy connection
  if (ws && ws.readyState === WebSocket.OPEN && isReady) {
    logger.info(`✅ [ELEVEN INIT] Reusing existing healthy connection`);
    return;
  }

  // Don't allow multiple simultaneous connection attempts
  if (isConnecting) {
    logger.warn(`⚠️ [ELEVEN INIT] Connection attempt already in progress`);
    return;
  }

  // Handle connection in progress
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    logger.info(
      `⏳ [ELEVEN INIT] Connection already in progress (CONNECTING state)`
    );
    return;
  }

  // Cleanup old connection if exists
  if (ws) {
    logger.info(
      `🧹 [ELEVEN INIT] Cleaning up old connection | readyState: ${ws.readyState}`
    );
    try {
      ws.removeAllListeners();
      if (ws.readyState !== WebSocket.CONNECTING) {
        ws.close(1000, "manual-reconnect");
      }
    } catch (e) {
      logger.error(`⚠️ [ELEVEN INIT] Error closing stale WS:`, e);
    }
    ws = null;
    isReady = false;
  }

  const uri = `${ELEVENLABS_BASE_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}/multi-stream-input?model_id=${ELEVENLABS_MODEL}&output_format=pcm_24000`;

  logger.info(
    `🌐 [ELEVEN INIT] Connecting to: ${ELEVENLABS_BASE_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}/...`
  );
  isConnecting = true;

  ws = new WebSocket(uri, {
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
  });

  // ============================================================================
  // WebSocket Event Handlers
  // ============================================================================

  ws.on("open", () => {
    isReady = true;
    isConnecting = false;
    reconnectAttempts = 0;
    logger.info(`🟢 [ELEVEN OPEN] WebSocket connection established and ready`);
    logger.info(
      `📊 [ELEVEN STATUS] connected=true, ready=true, activeContexts=${activeContexts.size}`
    );
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      logger.error(`⚠️ [ELEVEN MESSAGE] Failed to parse message:`, err);
      return;
    }

    const ctxId = msg.contextId || msg.context_id;
    const isFinal = msg.is_final ?? msg.isFinal;

    logger.info(
      `📨 [ELEVEN->BE] Message received | contextId: ${ctxId}, hasAudio: ${!!msg.audio}, isFinal: ${isFinal}`
    );

    // Handle audio chunks
    if (msg.audio) {
      const socket = contextToSocketMap.get(ctxId);

      if (socket) {
        const cleanAudioBase64 = msg.audio.replace(/\s/g, "");
        const audioSize = cleanAudioBase64.length;

        logger.info(
          `🔊 [AUDIO CHUNK] contextId: ${ctxId}, size: ${audioSize}, isFinal: ${isFinal}, socketId: ${socket.id}`
        );

        const audioObj = {
          contextId: ctxId,
          audio: cleanAudioBase64,
          isFinal: isFinal,
        };

        logger.info(
          `📤 [BE->FE] Emitting 'ai-audio-chunk' to Socket ${socket.id}`
        );
        socket.emit("ai-audio-chunk", audioObj);
        logger.info(`✅ [BE->FE] Audio chunk emitted successfully`);
      } else {
        logger.warn(
          `⚠️ [AUDIO CHUNK] No socket found for contextId: ${ctxId} | activeContexts: ${Array.from(
            activeContexts
          ).join(", ")}`
        );
        logger.warn(
          `⚠️ [AUDIO CHUNK] Available mappings: ${Array.from(
            contextToSocketMap.keys()
          ).join(", ")}`
        );
      }
    }

    // Handle final chunk
    if (isFinal) {
      logger.info(
        `🏁 [AUDIO FINAL] Final chunk received for contextId: ${ctxId}`
      );

      const hadContext = activeContexts.has(ctxId);
      const hadMapping = contextToSocketMap.has(ctxId);

      activeContexts.delete(ctxId);
      const socket = contextToSocketMap.get(ctxId);
      contextToSocketMap.delete(ctxId);

      logger.info(
        `🧹 [CLEANUP] Context cleanup | hadContext: ${hadContext}, hadMapping: ${hadMapping}`
      );
      logger.info(
        `📊 [STATUS] Remaining contexts: ${activeContexts.size}, mappings: ${contextToSocketMap.size}`
      );

      // Notify frontend that audio is complete
      if (socket) {
        logger.info(
          `📤 [BE->FE] Emitting 'ai-audio-complete' for contextId: ${ctxId} to Socket ${socket.id}`
        );
        socket.emit("ai-audio-complete", { contextId: ctxId });
      }
    }

    // Handle errors
    if (msg.error) {
      logger.error(
        `❌ [ELEVEN ERROR] Error in message for contextId: ${ctxId}`
      );
      logger.error(`   Error details:`, JSON.stringify(msg.error, null, 2));

      const socket = contextToSocketMap.get(ctxId);
      if (socket) {
        socket.emit("ai-error", {
          message: "TTS error occurred",
          error: msg.error,
          contextId: ctxId,
        });
      }
    }
  });

  ws.on("error", (err) => {
    logger.error(`❌ [ELEVEN ERROR] WebSocket error:`, err);
    logger.error(
      `📊 [ERROR STATE] isReady: ${isReady}, isConnecting: ${isConnecting}, activeContexts: ${activeContexts.size}`
    );

    isReady = false;
    isConnecting = false;

    // Notify all active sockets
    contextToSocketMap.forEach((socket, ctxId) => {
      logger.info(
        `📤 [ERROR NOTIFY] Notifying Socket ${socket.id} about connection error`
      );
      socket.emit("ai-error", { message: "TTS connection error" });
    });

    activeContexts.clear();
    contextToSocketMap.clear();

    logger.info(`🧹 [ERROR CLEANUP] All contexts and mappings cleared`);
  });

  ws.on("close", (code, reason) => {
    const reasonStr = reason.toString();
    logger.info(
      `🔴 [ELEVEN CLOSE] WebSocket closed | code: ${code}, reason: "${reasonStr}"`
    );
    logger.info(
      `📊 [CLOSE STATE] isReady: ${isReady}, isConnecting: ${isConnecting}, activeContexts: ${activeContexts.size}`
    );

    isReady = false;
    isConnecting = false;
    ws = null;

    // Notify all active sockets
    contextToSocketMap.forEach((socket, ctxId) => {
      logger.info(
        `📤 [CLOSE NOTIFY] Notifying Socket ${socket.id} about connection close`
      );
      socket.emit("ai-error", { message: "TTS connection closed" });
    });

    activeContexts.clear();
    contextToSocketMap.clear();

    // Auto-reconnect with backoff (unless manual close)
    if (!reasonStr.includes("manual")) {
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttempts - 1),
          10000
        );

        logger.info(
          `🔄 [RECONNECT] Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`
        );

        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          logger.info(
            `🔄 [RECONNECT] Executing reconnect attempt ${reconnectAttempts}`
          );
          initElevenLabs();
        }, delay);
      } else {
        logger.error(
          `❌ [RECONNECT] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
        );
      }
    } else {
      logger.info(`ℹ️ [CLOSE] Manual close detected, no reconnect scheduled`);
    }
  });
}

/**
 * Start a new context for a user session
 */
export function startContext(socket) {
  logger.info(
    `🆕 [START CONTEXT] Attempting to start context for Socket ${socket.id}`
  );
  logger.info(
    `📊 [PRE-START STATE] wsState: ${ws?.readyState}, isReady: ${isReady}, activeContexts: ${activeContexts.size}`
  );

  // Check if WebSocket is ready
  if (!ws || ws.readyState !== WebSocket.OPEN || !isReady) {
    logger.error(
      `❌ [START CONTEXT] Cannot start context - WebSocket not ready`
    );
    logger.error(
      `   Details: ws=${!!ws}, wsState=${ws?.readyState}, isReady=${isReady}`
    );
    return null;
  }

  const contextId = uuidv4();
  logger.info(`🎲 [CONTEXT ID] Generated new contextId: ${contextId}`);

  const initMsg = {
    text: " ",
    context_id: contextId,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      use_speaker_boost: false,
    },
    generation_config: {
      chunk_length_schedule: [50, 60, 100, 120],
    },
  };

  try {
    logger.info(`📤 [START CONTEXT] Sending init message to ElevenLabs`);
    logger.info(`📋 [INIT MESSAGE]`, JSON.stringify(initMsg, null, 2));

    ws.send(JSON.stringify(initMsg));

    // Register context after successful send
    activeContexts.add(contextId);
    contextToSocketMap.set(contextId, socket);

    logger.info(`✅ [START CONTEXT] Context started successfully`);
    logger.info(
      `📊 [POST-START STATE] contextId: ${contextId}, activeContexts: ${activeContexts.size}, mappings: ${contextToSocketMap.size}`
    );
    logger.info(
      `🗺️ [MAPPINGS] Active contexts: ${Array.from(activeContexts).join(", ")}`
    );

    return contextId;
  } catch (error) {
    logger.error(`❌ [START CONTEXT] Error starting context:`, error);
    logger.error(`   contextId: ${contextId}, socketId: ${socket.id}`);

    // Cleanup on error
    activeContexts.delete(contextId);
    contextToSocketMap.delete(contextId);

    return null;
  }
}

/**
 * Send text to ElevenLabs for TTS
 */
export function sendTextToElevenLabs(textChunk, contextId, options = {}) {
  const chunkLength = textChunk.length;
  const isFlush = options.flush || false;

  logger.info(
    `📤 [SEND TEXT] contextId: ${contextId}, length: ${chunkLength}, flush: ${isFlush}`
  );

  // Check WebSocket state
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.error(
      `❌ [SEND TEXT] Cannot send - WebSocket not open | wsState: ${ws?.readyState}`
    );
    return false;
  }

  // Verify context exists in our tracking
  if (!activeContexts.has(contextId)) {
    logger.warn(
      `⚠️ [SEND TEXT] Context not in activeContexts | contextId: ${contextId}`
    );
    logger.warn(`   Active contexts: ${Array.from(activeContexts).join(", ")}`);
  }

  const payload = { text: textChunk, context_id: contextId };
  if (isFlush) {
    payload.flush = true;
    logger.info(`🚰 [FLUSH] Flushing buffer for contextId: ${contextId}`);
  }

  try {
    logger.info(`📋 [PAYLOAD]`, JSON.stringify(payload));
    ws.send(JSON.stringify(payload));
    logger.info(`✅ [SEND TEXT] Text sent successfully to ElevenLabs`);
    return true;
  } catch (error) {
    logger.error(`❌ [SEND TEXT] Error sending text:`, error);
    logger.error(`   contextId: ${contextId}, textLength: ${chunkLength}`);
    return false;
  }
}

/**
 * Close a specific context
 */
export function closeContext(contextId) {
  logger.info(`🧹 [CLOSE CONTEXT] Attempting to close contextId: ${contextId}`);
  logger.info(
    `📊 [PRE-CLOSE STATE] wsState: ${
      ws?.readyState
    }, hasContext: ${activeContexts.has(contextId)}`
  );

  // Check WebSocket state
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.warn(
      `⚠️ [CLOSE CONTEXT] WebSocket not open, performing local cleanup only | wsState: ${ws?.readyState}`
    );
    activeContexts.delete(contextId);
    contextToSocketMap.delete(contextId);
    return false;
  }

  // Check if context exists
  if (!contextId || !activeContexts.has(contextId)) {
    logger.warn(
      `⚠️ [CLOSE CONTEXT] Context doesn't exist or already closed | contextId: ${contextId}`
    );
    logger.warn(`   Active contexts: ${Array.from(activeContexts).join(", ")}`);
    return false;
  }

  try {
    logger.info(`📤 [CLOSE CONTEXT] Sending close message to ElevenLabs`);
    ws.send(JSON.stringify({ context_id: contextId, close_context: true }));

    activeContexts.delete(contextId);
    contextToSocketMap.delete(contextId);

    logger.info(`✅ [CLOSE CONTEXT] Context closed successfully`);
    logger.info(
      `📊 [POST-CLOSE STATE] Remaining contexts: ${activeContexts.size}, mappings: ${contextToSocketMap.size}`
    );

    return true;
  } catch (error) {
    logger.error(`❌ [CLOSE CONTEXT] Error closing context:`, error);
    logger.error(`   contextId: ${contextId}`);

    // Cleanup local state even if send fails
    activeContexts.delete(contextId);
    contextToSocketMap.delete(contextId);

    return false;
  }
}

/**
 * Close the entire ElevenLabs WebSocket (should rarely be used)
 */
export function closeElevenLabs(reason = "manual") {
  logger.info(
    `🔌 [CLOSE ELEVENLABS] Closing ElevenLabs connection | reason: "${reason}"`
  );
  logger.info(
    `📊 [PRE-CLOSE STATE] activeContexts: ${activeContexts.size}, mappings: ${contextToSocketMap.size}`
  );

  clearTimeout(reconnectTimeout);
  reconnectAttempts = 0;
  isConnecting = false;

  // Close all active contexts first
  if (activeContexts.size > 0) {
    const contexts = Array.from(activeContexts);
    logger.info(
      `🧹 [CLOSE ELEVENLABS] Closing ${contexts.length} active contexts`
    );

    contexts.forEach((ctxId) => {
      logger.info(`🧹 [BULK CLOSE] Closing context: ${ctxId}`);
      closeContext(ctxId);
    });
  }

  // Close WebSocket
  if (ws) {
    try {
      logger.info(
        `🔌 [CLOSE ELEVENLABS] Closing WebSocket | readyState: ${ws.readyState}`
      );
      ws.removeAllListeners();

      if (ws.readyState !== WebSocket.CONNECTING) {
        ws.close(1000, reason);
      }

      logger.info(`✅ [CLOSE ELEVENLABS] WebSocket closed`);
    } catch (e) {
      logger.error(`⚠️ [CLOSE ELEVENLABS] Error closing WebSocket:`, e);
    }
    ws = null;
    isReady = false;
  }

  logger.info(`✅ [CLOSE ELEVENLABS] Shutdown complete`);
}

/**
 * Get current ElevenLabs connection status
 */
export function getElevenLabsStatus() {
  const status = {
    connected: ws?.readyState === WebSocket.OPEN,
    ready: isReady,
    connecting: isConnecting,
    activeContexts: Array.from(activeContexts),
    activeMappings: Array.from(contextToSocketMap.keys()),
    reconnectAttempts: reconnectAttempts,
    wsState: ws?.readyState,
  };

  logger.info(`📊 [GET STATUS]`, JSON.stringify(status, null, 2));

  return status;
}
