import logger from "../utils/logger.js";
import {
  WEBRTC_ENABLED,
  WEBRTC_ICE_SERVERS,
  WEBRTC_SIGNALING_ROLE,
} from "../config/env.js";
import {
  downmixToMonoInt16,
  int16ToBase64Pcm,
  resampleInt16Linear,
} from "../utils/pcmConverter.js";

let wrtc = null;
try {
  // ESM dynamic import exposes CJS exports on `.default`.
  const mod = await import("wrtc");
  wrtc = mod.default ?? mod;

  if (typeof wrtc?.RTCPeerConnection !== "function") {
    throw new Error("wrtc module loaded but RTCPeerConnection is missing");
  }
} catch (err) {
  wrtc = null;
  if (WEBRTC_ENABLED) {
    logger.error(
      "❌ WebRTC is enabled but 'wrtc' failed to load. WebRTC audio will be unavailable.",
      err?.message || err,
    );
  }
}

const sessions = new Map(); // key: socket.id

function emitWebRtcError(socket, sessionId, payload) {
  socket.emit("webrtc-error", payload);
  logger.warn(`⚠️ [${sessionId}] WebRTC error: ${JSON.stringify(payload)}`);
}

function isCallerRole(role) {
  return (role || "caller").toLowerCase() === "caller";
}

function toInt32(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n | 0;
}

/** Unwrap Socket.IO payloads into { type, sdp } for wrtc. */
function normalizeSessionDescription(input) {
  if (!input) {
    throw new Error("Missing session description");
  }

  let desc = input;

  // { sdp: { type, sdp } } from some clients
  if (
    desc.sdp &&
    typeof desc.sdp === "object" &&
    typeof desc.sdp.sdp === "string" &&
    desc.sdp.type
  ) {
    desc = desc.sdp;
  }

  if (typeof desc.sdp !== "string" || !desc.type) {
    throw new Error("Invalid session description shape");
  }

  return { type: desc.type, sdp: desc.sdp };
}

/**
 * wrtc requires sdpMLineIndex as a 32-bit integer; missing values throw.
 * Pass only the fields the native layer needs.
 */
function normalizeIceCandidate(input) {
  if (!input) return null;

  let c = input;

  if (c.candidate && typeof c.candidate === "object") {
    c = c.candidate;
  }

  const candidateStr =
    typeof c.candidate === "string" ? c.candidate.trim() : "";

  // End-of-candidates or empty payload — ignore silently.
  if (!candidateStr) return null;

  const sdpMid = c.sdpMid != null && c.sdpMid !== "" ? String(c.sdpMid) : null;

  let sdpMLineIndex =
    c.sdpMLineIndex != null && c.sdpMLineIndex !== ""
      ? toInt32(c.sdpMLineIndex, 0)
      : sdpMid != null
        ? toInt32(sdpMid, 0)
        : 0;

  return {
    candidate: candidateStr,
    sdpMid,
    sdpMLineIndex,
  };
}

function serializeLocalDescription(localDescription) {
  if (!localDescription) return null;
  return {
    type: localDescription.type,
    sdp: localDescription.sdp,
  };
}

function serializeIceCandidate(candidate) {
  if (!candidate?.candidate) return null;
  return normalizeIceCandidate(candidate);
}

export function getWebRtcSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function destroyWebRtcSession(sessionId, reason = "destroy") {
  const s = sessions.get(sessionId);
  if (!s) return;

  sessions.delete(sessionId);

  try {
    if (s.audioSink) {
      try {
        s.audioSink.stop();
      } catch {
        // ignore
      }
      s.audioSink = null;
    }

    if (s.audioTrack) {
      try {
        s.audioTrack.stop();
      } catch {
        // ignore
      }
      s.audioTrack = null;
    }

    if (s.pc) {
      try {
        s.pc.close();
      } catch {
        // ignore
      }
      s.pc = null;
    }
  } finally {
    logger.info(`🧹 [${sessionId}] WebRTC session closed (${reason})`);
  }
}

export function createWebRtcSession(socket, sessionId, { onAudioBase64 } = {}) {
  if (!WEBRTC_ENABLED) return null;
  if (!wrtc) return null;

  destroyWebRtcSession(sessionId, "recreate");

  const pc = new wrtc.RTCPeerConnection({
    iceServers: WEBRTC_ICE_SERVERS,
  });

  const session = {
    pc,
    socket,
    sessionId,
    role: WEBRTC_SIGNALING_ROLE,
    remoteDescriptionSet: false,
    pendingIceCandidates: [],
    audioSink: null,
    audioTrack: null,
    useWebRtcAudio: false,
    pcm24kAcc: new Int16Array(0),
    onAudioBase64: typeof onAudioBase64 === "function" ? onAudioBase64 : null,
  };

  sessions.set(sessionId, session);

  pc.onicecandidate = (event) => {
    const serialized = serializeIceCandidate(event?.candidate);
    if (!serialized) return;
    socket.emit("webrtc-ice-candidate", {
      candidate: serialized,
    });
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    logger.info(`🧊 [${sessionId}] ICE state: ${state}`);

    if (state === "failed") {
      emitWebRtcError(socket, sessionId, {
        code: "ICE_FAILED",
        message: "ICE connection failed",
        recoverable: true,
      });
      destroyWebRtcSession(sessionId, "ice-failed");
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    logger.info(`🔗 [${sessionId}] WebRTC connection state: ${state}`);

    if (state === "failed") {
      emitWebRtcError(socket, sessionId, {
        code: "CONNECTION_FAILED",
        message: "WebRTC connection failed",
        recoverable: true,
      });
      destroyWebRtcSession(sessionId, "connection-failed");
    }
  };

  pc.ontrack = (event) => {
    try {
      const track = event?.track;
      if (!track || track.kind !== "audio") return;

      // One active incoming audio track per session.
      if (session.audioSink) {
        try {
          session.audioSink.stop();
        } catch {
          // ignore
        }
        session.audioSink = null;
      }

      session.audioTrack = track;
      session.useWebRtcAudio = true;

      logger.info(`🎧 [${sessionId}] WebRTC audio track received`);
      socket.emit("webrtc-connected");

      const sink = new wrtc.nonstandard.RTCAudioSink(track);
      session.audioSink = sink;

      sink.ondata = (data) => {
        try {
          // data: { samples: Int16Array, sampleRate: number, bitsPerSample: number, channelCount: number, numberOfFrames: number }
          if (!session.onAudioBase64) return;

          const samples = data?.samples;
          const sampleRate = data?.sampleRate || 48000;
          const channelCount = data?.channelCount || 1;
          if (!samples || samples.length === 0) return;

          const mono = downmixToMonoInt16(samples, channelCount);
          const pcm24k = resampleInt16Linear(mono, sampleRate, 24000);

          // Accumulate and emit ~20ms frames (480 samples @ 24kHz).
          const frameSize = 480;
          let acc = session.pcm24kAcc;
          if (acc.length === 0) {
            acc = pcm24k;
          } else {
            const merged = new Int16Array(acc.length + pcm24k.length);
            merged.set(acc, 0);
            merged.set(pcm24k, acc.length);
            acc = merged;
          }

          while (acc.length >= frameSize) {
            const frame = acc.subarray(0, frameSize);
            const b64 = int16ToBase64Pcm(frame);
            session.onAudioBase64(b64);
            acc = acc.subarray(frameSize);
          }

          // Keep remainder for next callback.
          if (
            acc.byteOffset === 0 &&
            acc.byteLength === acc.buffer.byteLength
          ) {
            // still backed by the same buffer, keep as-is
            session.pcm24kAcc = acc;
          } else {
            session.pcm24kAcc = new Int16Array(acc);
          }
        } catch (err) {
          emitWebRtcError(socket, sessionId, {
            code: "AUDIO_PIPELINE_ERROR",
            message: "Failed to process incoming WebRTC audio",
            recoverable: true,
          });
          logger.error(`❌ [${sessionId}] WebRTC audio pipeline error:`, err);
        }
      };
    } catch (err) {
      emitWebRtcError(socket, sessionId, {
        code: "ONTRACK_ERROR",
        message: "Failed to attach incoming audio track",
        recoverable: true,
      });
      logger.error(`❌ [${sessionId}] WebRTC ontrack error:`, err);
    }
  };

  return session;
}

export function registerWebRtcSocketHandlers(socket, sessionId) {
  if (!WEBRTC_ENABLED || !wrtc) return;

  function ensureSession() {
    const s = sessions.get(sessionId);
    if (!s) return null;
    if (!s.pc) return null;
    return s;
  }

  socket.on("webrtc-ready", async () => {
    const s = ensureSession();
    if (!s) return;

    if (isCallerRole(s.role)) {
      // Browser is expected to send the offer in this role.
      return;
    }

    try {
      // Ensure we can receive audio.
      s.pc.addTransceiver("audio", { direction: "recvonly" });

      const offer = await s.pc.createOffer();
      await s.pc.setLocalDescription(offer);

      socket.emit("webrtc-offer", {
        sdp: serializeLocalDescription(s.pc.localDescription),
      });
    } catch (err) {
      emitWebRtcError(socket, sessionId, {
        code: "CREATE_OFFER_FAILED",
        message: "Failed to create WebRTC offer",
        recoverable: true,
      });
      logger.error(`❌ [${sessionId}] webrtc-ready/createOffer failed:`, err);
    }
  });

  socket.on("webrtc-offer", async (payload = {}) => {
    const s = ensureSession();
    if (!s) return;

    try {
      // Browser offer already includes the mic m-line — do not add another transceiver.
      const descInit = normalizeSessionDescription(payload.sdp ?? payload);
      const desc = new wrtc.RTCSessionDescription(descInit);
      await s.pc.setRemoteDescription(desc);
      s.remoteDescriptionSet = true;

      // Flush any ICE candidates that arrived early.
      for (const candInit of s.pendingIceCandidates.splice(0)) {
        await s.pc.addIceCandidate(candInit);
      }

      const answer = await s.pc.createAnswer();
      await s.pc.setLocalDescription(answer);

      socket.emit("webrtc-answer", {
        sdp: serializeLocalDescription(s.pc.localDescription),
      });
    } catch (err) {
      s.remoteDescriptionSet = false;
      s.pendingIceCandidates.length = 0;

      emitWebRtcError(socket, sessionId, {
        code: "INVALID_SDP",
        message: "Failed to handle WebRTC offer",
        recoverable: true,
      });
      logger.error(`❌ [${sessionId}] webrtc-offer failed:`, err);
    }
  });

  socket.on("webrtc-answer", async (payload = {}) => {
    const s = ensureSession();
    if (!s) return;

    try {
      const descInit = normalizeSessionDescription(payload.sdp ?? payload);
      const desc = new wrtc.RTCSessionDescription(descInit);
      await s.pc.setRemoteDescription(desc);
      s.remoteDescriptionSet = true;

      for (const candInit of s.pendingIceCandidates.splice(0)) {
        await s.pc.addIceCandidate(candInit);
      }
    } catch (err) {
      emitWebRtcError(socket, sessionId, {
        code: "INVALID_SDP",
        message: "Failed to handle WebRTC answer",
        recoverable: true,
      });
      logger.error(`❌ [${sessionId}] webrtc-answer failed:`, err);
    }
  });

  socket.on("webrtc-ice-candidate", async (payload) => {
    const s = ensureSession();
    if (!s) return;

    try {
      const candInit = normalizeIceCandidate(payload);
      if (!candInit) return;

      if (!s.remoteDescriptionSet) {
        s.pendingIceCandidates.push(candInit);
        return;
      }

      await s.pc.addIceCandidate(candInit);
    } catch (err) {
      emitWebRtcError(socket, sessionId, {
        code: "ADD_ICE_FAILED",
        message: "Failed to add ICE candidate",
        recoverable: true,
      });
      logger.error(`❌ [${sessionId}] webrtc-ice-candidate failed:`, err);
    }
  });

  socket.on("webrtc-reset", () => {
    const existing = sessions.get(sessionId);
    if (!existing) return;

    const onAudioBase64 = existing.onAudioBase64;
    createWebRtcSession(socket, sessionId, { onAudioBase64 });
  });

  socket.on("webrtc-close", () => {
    destroyWebRtcSession(sessionId, "client-close");
  });
}
