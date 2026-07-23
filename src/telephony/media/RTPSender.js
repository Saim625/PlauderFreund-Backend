import dgram from "dgram";
import { RTPUtils } from "../utils/codecs.js";

export class RTPSender {
  constructor(targetHost = "127.0.0.1", targetPort = 10002) {
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.socket = dgram.createSocket("udp4");
    this.sequenceNumber = 0;
    this.timestamp = 0;
    this.ssrc = Math.floor(Math.random() * 100000);
  }

  /**
   * Dynamically set the destination port provided by Asterisk via RTPReceiver's rinfo
   */
  setTarget(host, port) {
    if (host) this.targetHost = host;
    if (port) this.targetPort = port;
  }

  /**
   * Send a chunk of µ-law audio over RTP to Asterisk
   * @param {Buffer} audioBuffer
   */
  sendAudio(audioBuffer) {
    if (!this.socket || !this.targetPort) return;

    const packet = RTPUtils.buildRTPPacket(
      audioBuffer,
      this.sequenceNumber++,
      this.timestamp,
      this.ssrc,
    );

    // 1 byte = 1 sample at 8kHz µ-law
    this.timestamp += audioBuffer.length;

    this.socket.send(
      packet,
      0,
      packet.length,
      this.targetPort,
      this.targetHost,
      (err) => {
        if (err) {
          console.error(
            `❌ [RTPSender] Error sending RTP packet to port ${this.targetPort}:`,
            err,
          );
        }
      },
    );
  }

  close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
