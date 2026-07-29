import { WEBRTC_TTS_ENABLED } from "../config/env.js";
import {
  getWebRtcSession,
  interruptTtsWebRtc,
  pushTtsPcmToWebRtc,
} from "./webrtcService.js";

/**
 * Routes ElevenLabs PCM to WebRTC (preferred) or Socket.IO (fallback).
 */
export function createTtsAudioTransport(sessionId, socket) {
  let chunkIndex = 0;
  let activeContextId = null;

  function useWebRtcTts() {
    if (!WEBRTC_TTS_ENABLED) return false;
    const session = getWebRtcSession(sessionId);
    return session?.useWebRtcTts === true;
  }

  return {
    pushChunk({ contextId, audio, isFinal = false }) {
      if (contextId !== activeContextId) {
        activeContextId = contextId;
        chunkIndex = 0;
      }

      if (useWebRtcTts()) {
        const pushed = pushTtsPcmToWebRtc(sessionId, audio);
        if (pushed) {
          if (chunkIndex === 0) {
            socket.emit("ai-audio-start", { contextId });
          }
          chunkIndex++;
          return;
        }
      }

      socket.emit("ai-audio-chunk", {
        contextId,
        index: chunkIndex,
        audio,
        sentAt: Date.now(),
        isFinal,
      });
      chunkIndex++;
    },

    pushComplete({ contextId }) {
      socket.emit("ai-audio-complete", { contextId });
      activeContextId = null;
      chunkIndex = 0;
    },

    pushError(payload) {
      socket.emit("ai-error", payload);
    },

    interrupt() {
      interruptTtsWebRtc(sessionId);
      activeContextId = null;
      chunkIndex = 0;
    },
  };
}
