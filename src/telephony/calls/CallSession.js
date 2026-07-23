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

    // Milestone 3 Media Components
    this.rtpReceiver = new RTPReceiver(10000);
    this.rtpSender = new RTPSender();
    this.externalMedia = new ExternalMedia({
      externalHost: "127.0.0.1:10000",
      format: "ulaw", // 16kHz PCM
    });
  }

  // src/telephony/calls/CallSession.js

  async answer() {
    try {
      console.log(
        `🔊 [Session ${this.channelId}] Answering call for ${this.user.number}...`,
      );

      const channelController = ariClient.Channel(this.channelId);
      await channelController.answer();
      console.log(`✅ [Session ${this.channelId}] Channel answered.`);

      // 1. Start listening for incoming audio packets
      this.rtpReceiver.start();

      // STEP 3 FIX: Forward audio from rtpReceiver -> externalMedia
      // This allows TelephonySocketAdapter to receive the audio stream!
      this.rtpReceiver.on("audio", (pcmBuffer) => {
        if (this.externalMedia) {
          this.externalMedia.emit("audio", pcmBuffer);
        }
      });

      // 2. Establish Asterisk External Media and Bridge
      await this.externalMedia.establish(this.channelId);
    } catch (error) {
      console.error(
        `❌ [Session ${this.channelId}] Error setting up media pipeline:`,
        error,
      );
    }
  }

  async end() {
    this.isActive = false;

    // Clean up media sockets and channels
    if (this.rtpReceiver) this.rtpReceiver.stop();
    if (this.rtpSender) this.rtpSender.close();
    if (this.externalMedia) await this.externalMedia.destroy();

    const duration = (new Date() - this.startTime) / 1000;
    console.log(
      `🔌 [Session ${this.channelId}] Session closed. Total call duration: ${duration}s`,
    );
  }
}
