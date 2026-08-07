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
    this.greetingAudioFormat = "pcm_24000";

    const mediaLabel = `Call:${this.channelId}`;
    // Let the OS allocate an isolated UDP port so concurrent calls cannot
    // compete for a process-wide fixed port.
    this.rtpReceiver = new RTPReceiver(0, `${mediaLabel}/in`);
    this.rtpSender = new RTPSender("127.0.0.1", null, `${mediaLabel}/out`);
    this.externalMedia = new ExternalMedia({
      externalHost: null,
      format: "ulaw",
    });
  }

  async prepare() {
    try {
      const rtpPort = await this.rtpReceiver.start();
      this.externalMedia.externalHost = `127.0.0.1:${rtpPort}`;

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

  async startRinging() {
    await ariClient.channels.ring(this.channelId);
  }

  async stopRinging() {
    await ariClient.channels.ringStop(this.channelId);
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

    this.rtpSender.sendSilence(250);

    this.rtpSender.sendGreeting(this.greetingAudio, this.greetingAudioFormat);

    return new Promise((resolve) => {
      this.rtpSender.whenIdle(resolve);
    });
  }

  waitForRtpTarget(timeoutMs = 4000) {
    return this.rtpSender.waitForTarget(timeoutMs);
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
