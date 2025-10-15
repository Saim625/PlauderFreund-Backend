import WebSocket from "ws";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MODEL,
  ELEVENLABS_VOICE_ID,
} from "../config/env.js";
import { v4 as uuidv4 } from "uuid";

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
    console.log("♻️ [ELEVEN] Reusing existing connection");
    return;
  }

  // ✅ Don't allow multiple simultaneous connection attempts
  if (isConnecting) {
    console.log("⏳ [ELEVEN] Already connecting, please wait...");
    return;
  }

  // ✅ Handle connection in progress
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    console.log("⏳ [ELEVEN] Connection already in progress, waiting...");
    return;
  }

  // ✅ Cleanup old connection if exists and not connecting
  if (ws) {
    console.log(
      `🧹 [ELEVEN] Cleaning up old connection (state: ${ws.readyState})`
    );
    try {
      ws.removeAllListeners();
      // Only close if not in CONNECTING state
      if (ws.readyState !== WebSocket.CONNECTING) {
        ws.close(1000, "manual-reconnect");
      }
    } catch (e) {
      console.warn("⚠️ [ELEVEN] Error closing stale WS:", e);
    }
    ws = null;
    isReady = false;
  }

  const uri = `${ELEVENLABS_BASE_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}/multi-stream-input?model_id=${ELEVENLABS_MODEL}&output_format=pcm_24000`;

  console.log("🔄 [ELEVEN] Connecting to:", uri);
  isConnecting = true; // ✅ Mark as connecting

  ws = new WebSocket(uri, {
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
  });

  ws.on("open", () => {
    console.log("✅ [ELEVEN] Multi-context WS OPEN");
    isReady = true;
    isConnecting = false; // ✅ Connection successful
    reconnectAttempts = 0;
  });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      console.error("⚠️ [ELEVEN] Failed to parse message:", err);
      return;
    }

    const ctxId = msg.contextId || msg.context_id;
    const isFinal = msg.is_final ?? msg.isFinal;

    if (msg.audio) {
      const cleanAudioBase64 = msg.audio.replace(/\s/g, "");
      console.log(
        `🎧 [ELEVEN] Audio for ${ctxId} (${isFinal ? "final" : "partial"})`
      );

      onAudioChunkRef?.({
        contextId: ctxId,
        audio: cleanAudioBase64,
        isFinal: isFinal,
      });
    }

    if (isFinal) {
      console.log(`🏁 [ELEVEN] Context ${ctxId} marked final`);
      activeContexts.delete(ctxId);
    }

    if (msg.error) {
      console.error("❌ [ELEVEN] Message error:", msg.error);
    }
  });

  ws.on("error", (err) => {
    console.error("❌ [ELEVEN] Socket error:", err);
    isReady = false;
    isConnecting = false; // ✅ Connection failed

    if (activeContexts.size > 0) {
      console.warn(
        `⚠️ [ELEVEN] Clearing ${activeContexts.size} active contexts due to error`
      );
      activeContexts.clear();
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`🔌 [ELEVEN] Socket closed (${code}): ${reason}`);
    isReady = false;
    isConnecting = false; // ✅ Connection ended
    ws = null;

    if (activeContexts.size > 0) {
      console.warn(
        `⚠️ [ELEVEN] Clearing ${activeContexts.size} active contexts on close`
      );
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
        console.log(
          `⏳ [ELEVEN] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
        );

        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          initElevenLabs(onAudioChunkRef);
        }, delay);
      } else {
        console.error(
          `❌ [ELEVEN] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`
        );
      }
    }
  });
}

export function startContext() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !isReady) {
    console.warn("⚠️ [ELEVEN] Cannot start context - socket not ready");
    console.warn(
      `   ws exists: ${!!ws}, readyState: ${
        ws?.readyState
      }, isReady: ${isReady}, isConnecting: ${isConnecting}`
    );
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
      chunk_length_schedule: [50, 80, 120, 150],
    },
  };

  try {
    ws.send(JSON.stringify(initMsg));
    console.log(`🆕 [ELEVEN] Initialized context: ${contextId}`);
    return contextId;
  } catch (error) {
    console.error("❌ [ELEVEN] Error starting context:", error);
    activeContexts.delete(contextId);
    return null;
  }
}

export function sendTextToElevenLabs(textChunk, contextId, options = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("⚠️ [ELEVEN] Socket not ready, cannot send text");
    return false;
  }

  if (!contextId || !activeContexts.has(contextId)) {
    console.warn("⚠️ [ELEVEN] Invalid or closed context:", contextId);
    return false;
  }

  const payload = { text: textChunk, context_id: contextId };
  if (options.flush) payload.flush = true;

  try {
    ws.send(JSON.stringify(payload));
    console.log(
      `📤 [ELEVEN] → ${contextId}: "${textChunk.slice(0, 40)}${
        textChunk.length > 40 ? "..." : ""
      }"${options.flush ? " (flush)" : ""}`
    );
    return true;
  } catch (error) {
    console.error("❌ [ELEVEN] Error sending text:", error);
    return false;
  }
}

export function closeContext(contextId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("⚠️ [ELEVEN] Cannot close context - socket not open");
    activeContexts.delete(contextId);
    return false;
  }

  if (!contextId || !activeContexts.has(contextId)) {
    console.warn(
      "⚠️ [ELEVEN] Attempt to close invalid/already-closed context:",
      contextId
    );
    return false;
  }

  try {
    ws.send(JSON.stringify({ context_id: contextId, close_context: true }));
    console.log(`📤 [ELEVEN] close_context sent for ${contextId}`);
    activeContexts.delete(contextId);
    return true;
  } catch (error) {
    console.error("❌ [ELEVEN] Error closing context:", error);
    activeContexts.delete(contextId);
    return false;
  }
}

export function closeElevenLabs(reason = "manual") {
  clearTimeout(reconnectTimeout);
  reconnectAttempts = 0;
  isConnecting = false; // ✅ Reset connecting flag

  if (activeContexts.size > 0) {
    console.log(
      `🧹 [ELEVEN] Closing ${activeContexts.size} active contexts before shutdown`
    );
    const contexts = Array.from(activeContexts);
    contexts.forEach((ctxId) => closeContext(ctxId));
  }

  if (ws) {
    try {
      console.log("🧹 [ELEVEN] Closing WebSocket:", reason);
      ws.removeAllListeners();
      // Only close if not already in CONNECTING state
      if (ws.readyState !== WebSocket.CONNECTING) {
        ws.close(1000, reason);
      }
    } catch (e) {
      console.warn("⚠️ [ELEVEN] Error closing WS:", e);
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
