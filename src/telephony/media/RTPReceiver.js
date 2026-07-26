import dgram from "dgram";
import { EventEmitter } from "events";
import { RTPUtils } from "../utils/codecs.js";
import { createMediaStats } from "../utils/telephonyDebug.js";

export class RTPReceiver extends EventEmitter {
  constructor(port = 10000, label = "RTPReceiver") {
    super();
    this.port = port;
    this.label = label;
    this.socket = null;
    this.isListening = false;
    this.stats = createMediaStats(label);
  }

  start() {
    this.socket = dgram.createSocket("udp4");

    this.socket.on("message", (msg, rinfo) => {
      const audioPayload = RTPUtils.parseRTPPayload(msg);

      if (audioPayload.length > 0) {
        this.stats.record(audioPayload.length, rinfo);
        this.emit("audio", audioPayload, rinfo);
      }
    });

    this.socket.on("error", (err) => {
      console.error(
        `❌ [${this.label}] UDP Socket error on port ${this.port}:`,
        err,
      );
    });

    this.socket.bind(this.port, "127.0.0.1", () => {
      this.isListening = true;
      console.log(
        `🎧 [${this.label}] Listening for incoming audio on UDP 127.0.0.1:${this.port}`,
      );
    });
  }

  stop() {
    if (this.socket && this.isListening) {
      this.stats.stop();
      this.socket.close();
      this.socket = null;
      this.isListening = false;
      console.log(
        `🧹 [${this.label}] Stopped listener on UDP port ${this.port}`,
      );
    }
  }
}
