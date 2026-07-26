import dgram from "dgram";
import { RTPUtils } from "../utils/codecs.js";
import { createMediaStats } from "../utils/telephonyDebug.js";

// PCMU (µ-law) payload type per RFC 3551
const ULAW_PAYLOAD_TYPE = 0;

export class RTPSender {
  constructor(targetHost = "127.0.0.1", targetPort = null, label = "RTPSender") {
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.label = label;
    this.socket = dgram.createSocket("udp4");
    this.sequenceNumber = 0;
    this.timestamp = 0;
    this.ssrc = Math.floor(Math.random() * 100000);
    this.stats = createMediaStats(label);
    this._targetSet = false;
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
    if (!this.socket || !this._targetSet || !this.targetPort) {
      if (!this._warnedNoTarget) {
        this._warnedNoTarget = true;
        console.warn(
          `⚠️ [${this.label}] Cannot send RTP — Asterisk return address not learned yet`,
        );
      }
      return;
    }

    const packet = RTPUtils.buildRTPPacket(
      audioBuffer,
      this.sequenceNumber++,
      this.timestamp,
      this.ssrc,
      ULAW_PAYLOAD_TYPE,
    );

    this.timestamp += audioBuffer.length;

    this.stats.recordOutbound(
      audioBuffer.length,
      this.targetHost,
      this.targetPort,
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

  close() {
    this.stats.stop();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
