import dgram from "dgram";
import { EventEmitter } from "events";
import { RTPUtils } from "../utils/codecs.js";

export class RTPReceiver extends EventEmitter {
  constructor(port = 10000) {
    super();
    this.port = port;
    this.socket = null;
    this.isListening = false;
  }

  start() {
    this.socket = dgram.createSocket("udp4");

    this.socket.on("message", (msg, rinfo) => {
      // Strip 12-byte RTP header to get raw audio payload
      const audioPayload = RTPUtils.parseRTPPayload(msg);

      if (audioPayload.length > 0) {
        /**
         * Emits audio payload + rinfo (so RTPSender knows Asterisk's dynamic return port)
         * @event RTPReceiver#audio
         */
        this.emit("audio", audioPayload, rinfo);
      }
    });

    this.socket.on("error", (err) => {
      console.error(
        `❌ [RTPReceiver] UDP Socket error on port ${this.port}:`,
        err,
      );
    });

    this.socket.bind(this.port, "127.0.0.1", () => {
      this.isListening = true;
      console.log(
        `🎧 [RTPReceiver] Listening for incoming audio on UDP 127.0.0.1:${this.port}`,
      );
    });
  }

  stop() {
    if (this.socket && this.isListening) {
      this.socket.close();
      this.socket = null;
      this.isListening = false;
      console.log(`🧹 [RTPReceiver] Stopped listener on UDP port ${this.port}`);
    }
  }
}
