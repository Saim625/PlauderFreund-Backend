import dgram from "dgram";
import { RTPUtils } from "../utils/codecs.js";
import { createMediaStats } from "../utils/telephonyDebug.js";

const ULAW_PAYLOAD_TYPE = 0;
const FRAME_SIZE = 160; // 20ms @ 8kHz µ-law (1 byte/sample)
const FRAME_MS = 20;
const ULAW_SILENCE = 0xff;

export class RTPSender {
  constructor(
    targetHost = "127.0.0.1",
    targetPort = null,
    label = "RTPSender",
  ) {
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.label = label;
    this.socket = dgram.createSocket("udp4");
    this.sequenceNumber = 0;
    this.timestamp = Math.floor(Math.random() * 4294967296);
    this.ssrc = Math.floor(Math.random() * 100000);
    this.stats = createMediaStats(label);
    this._targetSet = false;

    this.frameQueue = [];
    this.pending = Buffer.alloc(0);
    this.pacingTimer = null;
    this.markerNext = true;
    this.idleCallbacks = [];
  }

  setTarget(host, port) {
    if (host) this.targetHost = host;
    if (port) this.targetPort = port;
    this._targetSet = true;
    console.log(
      `🎯 [${this.label}] RTP return path set → ${this.targetHost}:${this.targetPort}`,
    );
  }

  sendAudio(audioBuffer) {
    if (!this._canSend()) return;

    this.pending = Buffer.concat([this.pending, audioBuffer]);
    this._enqueueFullFrames();
    this._ensurePacing();
  }

  /** Pad and enqueue any trailing partial frame (call at end of TTS utterance). */
  flush() {
    if (!this._canSend()) return;

    if (this.pending.length > 0) {
      const frame = Buffer.alloc(FRAME_SIZE, ULAW_SILENCE);
      this.pending.copy(frame);
      this.frameQueue.push(frame);
      this.pending = Buffer.alloc(0);
    }

    this._ensurePacing();
  }

  clearQueue() {
    this.frameQueue = [];
    this.pending = Buffer.alloc(0);
    this.markerNext = true;
    this.idleCallbacks = [];
    this._stopPacing();
  }

  whenIdle(callback) {
    if (typeof callback !== "function") return;

    if (this.frameQueue.length === 0 && this.pending.length === 0) {
      callback();
      return;
    }

    this.idleCallbacks.push(callback);
    this._ensurePacing();
  }

  close() {
    this._stopPacing();
    this.stats.stop();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  _canSend() {
    if (this.socket && this._targetSet && this.targetPort) return true;

    if (!this._warnedNoTarget) {
      this._warnedNoTarget = true;
      console.warn(
        `⚠️ [${this.label}] Cannot send RTP — Asterisk return address not learned yet`,
      );
    }
    return false;
  }

  _enqueueFullFrames() {
    while (this.pending.length >= FRAME_SIZE) {
      this.frameQueue.push(this.pending.subarray(0, FRAME_SIZE));
      this.pending = this.pending.subarray(FRAME_SIZE);
    }
  }

  _ensurePacing() {
    if (this.pacingTimer) return;
    if (this.frameQueue.length === 0) return;

    this._sendNextFrame();
    this.pacingTimer = setInterval(() => this._sendNextFrame(), FRAME_MS);
  }

  _stopPacing() {
    if (!this.pacingTimer) return;
    clearInterval(this.pacingTimer);
    this.pacingTimer = null;
  }

  _sendNextFrame() {
    if (!this._canSend()) {
      this._stopPacing();
      return;
    }

    if (this.frameQueue.length === 0) {
      this._stopPacing();
      this._fireIdleCallbacks();
      return;
    }

    const frame = this.frameQueue.shift();
    const marker = this.markerNext;
    this.markerNext = false;

    const packet = RTPUtils.buildRTPPacket(
      frame,
      this.sequenceNumber++,
      this.timestamp,
      this.ssrc,
      ULAW_PAYLOAD_TYPE,
      marker,
    );

    this.timestamp += FRAME_SIZE;

    this.stats.recordOutbound(FRAME_SIZE, this.targetHost, this.targetPort);

    console.log(
      `📤 Sending RTP frame seq=${this.sequenceNumber} (${frame.length} bytes)`,
    );

    this.socket.send(
      packet,
      0,
      packet.length,
      this.targetPort,
      this.targetHost,
      (err) => {
        if (err) {
          console.error(
            `❌ [${this.label}] Error sending RTP packet to ${this.targetHost}:${this.targetPort}:`,
            err,
          );
        }
      },
    );
  }

  _fireIdleCallbacks() {
    if (this.idleCallbacks.length === 0) return;
    const callbacks = this.idleCallbacks.splice(0);
    for (const cb of callbacks) cb();
  }
}
