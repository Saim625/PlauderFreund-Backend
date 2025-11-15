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
  return new Promise((resolve, reject) => {
    // Already ready
    if (ws && ws.readyState === WebSocket.OPEN && isReady) {
      return resolve();
    }

    const startTime = Date.now();
    let checkCount = 0;

    const checkInterval = setInterval(() => {
      checkCount++;
      const elapsed = Date.now() - startTime;

      if (ws && ws.readyState === WebSocket.OPEN && isReady) {
        clearInterval(checkInterval);
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
  // Reuse existing healthy connection
  if (ws && ws.readyState === WebSocket.OPEN && isReady) {
    return;
  }

  // Don't allow multiple simultaneous connection attempts
  if (isConnecting) {
    return;
  }

  // Handle connection in progress
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    return;
  }

  // Cleanup old connection if exists
  if (ws) {
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
  isConnecting = true;

  ws = new WebSocket(uri, {
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
  });

  ws.on("open", () => {
    isReady = true;
    isConnecting = false;
    reconnectAttempts = 0;
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
    // Handle audio chunks
    if (msg.audio) {
      const socket = contextToSocketMap.get(ctxId);

      if (socket) {
        const cleanAudioBase64 = msg.audio.replace(/\s/g, "");

        const audioObj = {
          contextId: ctxId,
          audio: cleanAudioBase64,
          isFinal: isFinal,
        };

        socket.emit("ai-audio-chunk", audioObj);
      } else {
        console.warn(
          `⚠️ [AUDIO CHUNK] No socket found for contextId: ${ctxId} | activeContexts: ${Array.from(
            activeContexts
          ).join(", ")}`
        );
        console.warn(
          `⚠️ [AUDIO CHUNK] Available mappings: ${Array.from(
            contextToSocketMap.keys()
          ).join(", ")}`
        );
      }
    }

    // Handle final chunk
    if (isFinal) {
      const hadContext = activeContexts.has(ctxId);
      const hadMapping = contextToSocketMap.has(ctxId);

      activeContexts.delete(ctxId);
      const socket = contextToSocketMap.get(ctxId);
      contextToSocketMap.delete(ctxId);

      // Notify frontend that audio is complete
      if (socket) {
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
      socket.emit("ai-error", { message: "TTS connection error" });
    });

    activeContexts.clear();
    contextToSocketMap.clear();
  });

  ws.on("close", (code, reason) => {
    const reasonStr = reason.toString();

    isReady = false;
    isConnecting = false;
    ws = null;

    // Notify all active sockets
    contextToSocketMap.forEach((socket, ctxId) => {
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

        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
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
      auto_mode: true,
    },
  };

  try {
    ws.send(JSON.stringify(initMsg));

    // Register context after successful send
    activeContexts.add(contextId);
    contextToSocketMap.set(contextId, socket);
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

  // Check WebSocket state
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logger.error(
      `❌ [SEND TEXT] Cannot send - WebSocket not open | wsState: ${ws?.readyState}`
    );
    return false;
  }

  // Verify context exists in our tracking
  if (!activeContexts.has(contextId)) {
    console.warn(
      `⚠️ [SEND TEXT] Context not in activeContexts | contextId: ${contextId}`
    );
    console.warn(
      `   Active contexts: ${Array.from(activeContexts).join(", ")}`
    );
  }

  const payload = { text: textChunk, context_id: contextId };
  if (isFlush) {
    payload.flush = true;
    logger.info(`🚰 [FLUSH] Flushing buffer for contextId: ${contextId}`);
  }

  try {
    ws.send(JSON.stringify(payload));
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
  // Check WebSocket state
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn(
      `⚠️ [CLOSE CONTEXT] WebSocket not open, performing local cleanup only | wsState: ${ws?.readyState}`
    );
    activeContexts.delete(contextId);
    contextToSocketMap.delete(contextId);
    return false;
  }

  // Check if context exists
  if (!contextId || !activeContexts.has(contextId)) {
    console.warn(
      `⚠️ [CLOSE CONTEXT] Context doesn't exist or already closed | contextId: ${contextId}`
    );
    console.warn(
      `   Active contexts: ${Array.from(activeContexts).join(", ")}`
    );
    return false;
  }

  try {
    ws.send(JSON.stringify({ context_id: contextId, close_context: true }));

    activeContexts.delete(contextId);
    contextToSocketMap.delete(contextId);
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
  clearTimeout(reconnectTimeout);
  reconnectAttempts = 0;
  isConnecting = false;

  // Close all active contexts first
  if (activeContexts.size > 0) {
    const contexts = Array.from(activeContexts);

    contexts.forEach((ctxId) => {
      closeContext(ctxId);
    });
  }

  // Close WebSocket
  if (ws) {
    try {
      ws.removeAllListeners();

      if (ws.readyState !== WebSocket.CONNECTING) {
        ws.close(1000, reason);
      }
    } catch (e) {
      logger.error(`⚠️ [CLOSE ELEVENLABS] Error closing WebSocket:`, e);
    }
    ws = null;
    isReady = false;
  }
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

  return status;
}
