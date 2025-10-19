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
let isConnecting = false; // ✅ Track connection state
let reconnectTimeout = null;
let onAudioChunkRef = null;
const activeContexts = new Set();
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Initialize (or reuse) the multi-context WebSocket connection
 */
export function initElevenLabs(onAudioChunk) {
  onAudioChunkRef = onAudioChunk;

  // ✅ Reuse existing healthy connection
  if (ws && ws.readyState === WebSocket.OPEN && isReady) {
    return;
  }

  // ✅ Don't allow multiple simultaneous connection attempts
  if (isConnecting) {
    return;
  }

  // ✅ Handle connection in progress
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    return;
  }

  // ✅ Cleanup old connection if exists and not connecting
  if (ws) {
    try {
      ws.removeAllListeners();
      // Only close if not in CONNECTING state
      if (ws.readyState !== WebSocket.CONNECTING) {
        ws.close(1000, "manual-reconnect");
      }
    } catch (e) {
      logger.error("⚠️ [ELEVEN] Error closing stale WS:", e);
    }
    ws = null;
    isReady = false;
  }

  const uri = `${ELEVENLABS_BASE_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}/multi-stream-input?model_id=${ELEVENLABS_MODEL}&output_format=pcm_24000`;

  isConnecting = true; // ✅ Mark as connecting

  ws = new WebSocket(uri, {
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
  });

  ws.on("open", () => {
    isReady = true;
    isConnecting = false; // ✅ Connection successful
    reconnectAttempts = 0;
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      logger.error("⚠️ [ELEVEN] Failed to parse message:", err);
      return;
    }

    const ctxId = msg.contextId || msg.context_id;
    const isFinal = msg.is_final ?? msg.isFinal;

    if (msg.audio) {
      const cleanAudioBase64 = msg.audio.replace(/\s/g, "");
      onAudioChunkRef?.({
        contextId: ctxId,
        audio: cleanAudioBase64,
        isFinal: isFinal,
      });
    }

    if (isFinal) {
      activeContexts.delete(ctxId);
    }

    if (msg.error) {
      logger.error("❌ [ELEVEN] Message error:");
      logger.error("   Error object:", JSON.stringify(msg.error, null, 2)); // ✅ Full error
    }
  });

  ws.on("error", (err) => {
    logger.error("❌ [ELEVEN] Socket error:", err);
    isReady = false;
    isConnecting = false; // ✅ Connection failed

    if (activeContexts.size > 0) {
      activeContexts.clear();
    }
  });

  ws.on("close", (code, reason) => {
    isReady = false;
    isConnecting = false; // ✅ Connection ended
    ws = null;

    if (activeContexts.size > 0) {
      activeContexts.clear();
    }

    // Auto-reconnect with backoff
    if (!reason.toString().includes("manual")) {
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(
          1000 * Math.pow(2, reconnectAttempts - 1),
          10000
        );

        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          initElevenLabs(onAudioChunkRef);
        }, delay);
      } else {
        logger.error(
          `❌ [ELEVEN] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`
        );
      }
    }
  });
}

export function startContext() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !isReady) {
    return null;
  }

  const contextId = uuidv4();
  activeContexts.add(contextId);

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
    ws.send(JSON.stringify(initMsg));
    return contextId;
  } catch (error) {
    logger.error("❌ [ELEVEN] Error starting context:", error);
    activeContexts.delete(contextId);
    return null;
  }
}

export function sendTextToElevenLabs(textChunk, contextId, options = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  if (!contextId || !activeContexts.has(contextId)) {
    return false;
  }

  const payload = { text: textChunk, context_id: contextId };
  if (options.flush) payload.flush = true;

  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    logger.error("❌ [ELEVEN] Error sending text:", error);
    return false;
  }
}

export function closeContext(contextId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    activeContexts.delete(contextId);
    return false;
  }

  if (!contextId || !activeContexts.has(contextId)) {
    return false;
  }

  try {
    ws.send(JSON.stringify({ context_id: contextId, close_context: true }));
    activeContexts.delete(contextId);
    return true;
  } catch (error) {
    activeContexts.delete(contextId);
    return false;
  }
}

export function closeElevenLabs(reason = "manual") {
  clearTimeout(reconnectTimeout);
  reconnectAttempts = 0;
  isConnecting = false; // ✅ Reset connecting flag

  if (activeContexts.size > 0) {
    const contexts = Array.from(activeContexts);
    contexts.forEach((ctxId) => closeContext(ctxId));
  }

  if (ws) {
    try {
      ws.removeAllListeners();
      // Only close if not already in CONNECTING state
      if (ws.readyState !== WebSocket.CONNECTING) {
        ws.close(1000, reason);
      }
    } catch (e) {
      logger.error("⚠️ [ELEVEN] Error closing WS:", e);
    }
    ws = null;
    isReady = false;
  }
}

export function getElevenLabsStatus() {
  return {
    connected: ws?.readyState === WebSocket.OPEN,
    ready: isReady,
    connecting: isConnecting,
    activeContexts: Array.from(activeContexts),
    reconnectAttempts: reconnectAttempts,
    wsState: ws?.readyState,
  };
}
