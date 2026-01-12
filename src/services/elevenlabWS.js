import WebSocket from "ws";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MODEL,
} from "../config/env.js";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger.js";
import { markAiSpeaking } from "./reengagementEngine.js";

// Store per-user connections
const userConnections = new Map();

const MAX_RECONNECT_ATTEMPTS = 3;
const READY_TIMEOUT = 5000;

/**
 * Connection class for each user
 */
class ElevenLabsConnection {
  constructor(userId, voiceId, socket) {
    this.userId = userId;
    this.voiceId = voiceId;
    this.socket = socket;
    this.ws = null;
    this.isReady = false;
    this.isConnecting = false;
    this.contextId = null;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.isManualClose = false;
  }

  /**
   * Initialize WebSocket connection
   */
  async connect() {
    // Prevent duplicate connections
    if (this.isConnecting) {
      logger.warn(`⚠️ [${this.userId}] Already connecting, skipping...`);
      return false;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isReady) {
      logger.info(`✅ [${this.userId}] Already connected`);
      return true;
    }

    // Validate voiceId BEFORE connecting
    if (!this.voiceId || this.voiceId === "undefined") {
      logger.error(`❌ [${this.userId}] Invalid voiceId: ${this.voiceId}`);
      this.socket.emit("ai-error", {
        message: "Voice configuration error. Please refresh.",
      });
      return false;
    }

    // Clean up old connection
    this.cleanup(false);

    const uri = `${ELEVENLABS_BASE_URL}/text-to-speech/${this.voiceId}/multi-stream-input?model_id=${ELEVENLABS_MODEL}&output_format=pcm_24000`;

    this.isConnecting = true;
    logger.info(`🔌 [${this.userId}] Connecting to ElevenLabs...`);

    this.ws = new WebSocket(uri, {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });

    this.setupEventHandlers();

    // Wait for connection to be ready
    return this.waitForReady();
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.ws.on("open", () => {
      this.isReady = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      logger.info(`✅ [${this.userId}] Connected to ElevenLabs`);
    });

    this.ws.on("message", (data) => {
      this.handleMessage(data);
    });

    this.ws.on("error", (err) => {
      logger.error(`❌ [${this.userId}] WebSocket error:`, err.message);
      this.isReady = false;
      this.isConnecting = false;

      this.socket.emit("ai-error", {
        message: "Audio connection error. Reconnecting...",
      });
    });

    this.ws.on("close", (code, reason) => {
      const reasonStr = reason.toString();
      logger.info(`🔌 [${this.userId}] Connection closed: ${reasonStr}`);

      this.isReady = false;
      this.isConnecting = false;

      // Only auto-reconnect if not manual close and voiceId is valid
      if (
        !this.isManualClose &&
        !reasonStr.includes("manual") &&
        !reasonStr.includes("voice_id_does_not_exist") &&
        this.voiceId &&
        this.voiceId !== "undefined"
      ) {
        this.handleReconnect();
      } else {
        logger.info(`ℹ️ [${this.userId}] No reconnect scheduled`);
        // Remove from global map if manual close
        if (this.isManualClose) {
          userConnections.delete(this.userId);
        }
      }
    });
  }

  /**
   * Handle incoming messages
   */
  handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      logger.error(`⚠️ [${this.userId}] Failed to parse message:`, err);
      return;
    }

    const messageContextId = msg.contextId || msg.context_id;
    console.log("messageContextId: ", messageContextId);

    // Handle audio chunks
    if (msg.audio) {
      const cleanAudioBase64 = msg.audio.replace(/\s/g, "");

      if (!global.chunkIndexMap) global.chunkIndexMap = new Map();
      const currentIndex = global.chunkIndexMap.get(this.userId) || 0;
      global.chunkIndexMap.set(this.userId, currentIndex + 1);

      const audioObj = {
        contextId: this.contextId,
        index: currentIndex,
        audio: cleanAudioBase64,
        isFinal: msg.isFinal || false,
      };

      markAiSpeaking(this.socket.id);
      this.socket.emit("ai-audio-chunk", audioObj);
    }

    // Handle final chunk
    if (msg.isFinal === true) {
      // 🔥 FIX: Capture contextId BEFORE it might be cleared
      const finalContextId = messageContextId || this.contextId;

      if (finalContextId) {
        this.socket.emit("ai-audio-complete", { contextId: finalContextId });
        logger.info(
          `✅ [${this.userId}] Audio stream complete for context: ${finalContextId}`
        );
      } else {
        logger.warn(
          `⚠️ [${this.userId}] Received isFinal but contextId is null`
        );
      }

      // ⚠️ DON'T close context here - let the handler do it when GPT is done
      // Context will be closed by: response.output_text.done OR ai-audio-done event
    }

    // Handle errors
    if (msg.error) {
      const errorDetail =
        typeof msg.error === "object"
          ? msg.error.message || JSON.stringify(msg.error)
          : msg.error;

      logger.error(`❌ [${this.userId}] ElevenLabs error: ${errorDetail}`);

      this.socket.emit("ai-error", {
        message: "Audio generation error",
        error: errorDetail,
      });
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  handleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(`❌ [${this.userId}] Max reconnect attempts reached`);
      this.socket.emit("ai-error", {
        message: "Audio connection failed. Please refresh the page.",
      });
      userConnections.delete(this.userId);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      10000
    );

    logger.info(
      `🔄 [${this.userId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
    );

    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Wait for connection to be ready
   */
  waitForReady(timeout = READY_TIMEOUT) {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isReady) {
        return resolve(true);
      }

      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isReady) {
          clearInterval(checkInterval);
          resolve(true);
        } else if (elapsed > timeout) {
          clearInterval(checkInterval);
          logger.error(
            `❌ [${this.userId}] Connection timeout after ${timeout}ms`
          );
          reject(new Error(`Connection timeout after ${timeout}ms`));
        }
      }, 100);
    });
  }

  /**
   * Start a new context
   */
  startContext(voiceConfig) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isReady) {
      logger.error(`❌ [${this.userId}] Cannot start context - not ready`);
      return null;
    }

    this.contextId = uuidv4();

    const initMsg = {
      text: " ",
      context_id: this.contextId,
      voice_settings: {
        stability:
          voiceConfig.empathyLevel === "high"
            ? 0.35
            : voiceConfig.empathyLevel === "medium"
            ? 0.55
            : 0.75,
        similarity_boost: 0.8,
        style:
          voiceConfig.empathyLevel === "high"
            ? 0.65
            : voiceConfig.empathyLevel === "medium"
            ? 0.3
            : 0.15,
        use_speaker_boost: false,
        speed:
          voiceConfig.speakingSpeed === "slow"
            ? 0.7
            : voiceConfig.speakingSpeed === "fast"
            ? 1.2
            : 1.0,
      },
      generation_config: {
        chunk_length_schedule: [50, 60, 100, 120],
        auto_mode: true,
      },
    };

    try {
      this.ws.send(JSON.stringify(initMsg));
      logger.info(`✅ [${this.userId}] Context started: ${this.contextId}`);
      return this.contextId;
    } catch (error) {
      logger.error(`❌ [${this.userId}] Error starting context:`, error);
      this.contextId = null;
      return null;
    }
  }

  /**
   * Send text to ElevenLabs
   */
  sendText(textChunk, options = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error(`❌ [${this.userId}] Cannot send - not connected`);
      return false;
    }

    if (!this.contextId) {
      logger.error(`❌ [${this.userId}] No active context`);
      return false;
    }

    const payload = {
      text: textChunk,
      context_id: this.contextId,
    };

    if (options.flush) {
      payload.flush = true;
      logger.info(`🚰 [${this.userId}] Flushing buffer`);
    }

    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      logger.error(`❌ [${this.userId}] Error sending text:`, error);
      return false;
    }
  }

  /**
   * Close current context
   */
  closeContext() {
    if (!this.contextId) {
      return false;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            context_id: this.contextId,
            close_context: true,
          })
        );
        logger.info(`🧹 [${this.userId}] Context closed: ${this.contextId}`);
      } catch (error) {
        logger.error(`❌ [${this.userId}] Error closing context:`, error);
      }
    }

    this.contextId = null;
    return true;
  }

  /**
   * Cleanup and close connection
   */
  cleanup(removeFromMap = true) {
    this.isManualClose = true;

    clearTimeout(this.reconnectTimeout);
    this.reconnectAttempts = 0;
    this.isConnecting = false;

    // Close context first
    this.closeContext();

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close(1000, "manual-close");
        }
      } catch (e) {
        logger.error(`⚠️ [${this.userId}] Error closing WebSocket:`, e);
      }
      this.ws = null;
      this.isReady = false;
    }

    if (removeFromMap) {
      userConnections.delete(this.userId);
      logger.info(`🧹 [${this.userId}] Connection cleaned up`);
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      userId: this.userId,
      connected: this.ws?.readyState === WebSocket.OPEN,
      ready: this.isReady,
      connecting: this.isConnecting,
      contextId: this.contextId,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

/**
 * PUBLIC API FUNCTIONS
 */

export async function initElevenLabsForUser(userId, voiceId, socket) {
  // Validate voiceId
  if (!voiceId || voiceId === "undefined") {
    logger.error(`❌ Invalid voiceId for user ${userId}: ${voiceId}`);
    throw new Error("Invalid voice configuration");
  }

  // Check if user already has a connection
  let connection = userConnections.get(userId);

  if (connection) {
    // If existing connection is healthy, reuse it
    if (
      connection.ws &&
      connection.ws.readyState === WebSocket.OPEN &&
      connection.isReady
    ) {
      logger.info(`♻️ [${userId}] Reusing existing connection`);
      return connection;
    }

    // Clean up stale connection
    connection.cleanup(false);
  }

  // Create new connection
  connection = new ElevenLabsConnection(userId, voiceId, socket);
  userConnections.set(userId, connection);

  // Connect
  await connection.connect();
  return connection;
}

export function getConnectionForUser(userId) {
  return userConnections.get(userId);
}

export function cleanupUserConnection(userId) {
  const connection = userConnections.get(userId);
  if (connection) {
    connection.cleanup(true);
  }
}

export function getAllConnectionsStatus() {
  const statuses = {};
  userConnections.forEach((conn, userId) => {
    statuses[userId] = conn.getStatus();
  });
  return statuses;
}

// Cleanup all connections (for server shutdown)
export function cleanupAllConnections() {
  logger.info(`🧹 Cleaning up ${userConnections.size} connections...`);
  userConnections.forEach((conn) => conn.cleanup(true));
  userConnections.clear();
}
