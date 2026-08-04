import ariClient from "../ari/ariClient.js";
import { RTPReceiver } from "../media/RTPReceiver.js";
import { RTPSender } from "../media/RTPSender.js";
import { ExternalMedia } from "../media/ExternalMedia.js";

export class CallSession {
  constructor(channel, user) {
    this.channelId = channel.id;
    this.callerID = channel.caller?.number;
    this.user = user;
    this.startTime = new Date();
    this.isActive = true;
    this.greetingAudio = null;

    const mediaLabel = `Call:${this.channelId}`;
    this.rtpReceiver = new RTPReceiver(10000, `${mediaLabel}/in`);
    this.rtpSender = new RTPSender("127.0.0.1", null, `${mediaLabel}/out`);
    this.externalMedia = new ExternalMedia({
      externalHost: "127.0.0.1:10000",
      format: "ulaw",
    });
  }

  async prepare() {
    try {
      this.rtpReceiver.start();

      this.rtpReceiver.on("audio", (audioPayload, rinfo) => {
        if (rinfo && !this._rtpTargetSet) {
          this.rtpSender.setTarget(rinfo.address, rinfo.port);
          this._rtpTargetSet = true;
        }

        if (this.externalMedia) {
          this.externalMedia.emit("audio", audioPayload);
        }
      });

      await this.externalMedia.establish(this.channelId);
    } catch (error) {
      console.error(
        `❌ [Session ${this.channelId}] Error preparing & setting up media pipeline:`,
        error,
      );
    }
  }

  async answer() {
    try {
      const channelController = ariClient.Channel(this.channelId);
      await channelController.answer();
    } catch (error) {
      console.error(
        `❌ [Session ${this.channelId}] Error answering call:`,
        error,
      );
    }
  }

  async playGreeting() {
    if (!this.greetingAudio) return;

    this.rtpSender.sendGreeting(this.greetingAudio);

    return new Promise((resolve) => {
      this.rtpSender.whenIdle(resolve);
    });
  }

  async end() {
    this.isActive = false;

    if (this.rtpReceiver) this.rtpReceiver.stop();
    if (this.rtpSender) this.rtpSender.close();
    if (this.externalMedia) await this.externalMedia.destroy();

    const duration = (new Date() - this.startTime) / 1000;
    console.log(
      `🔌 [Session ${this.channelId}] Session closed. Total call duration: ${duration}s`,
    );
  }
}
