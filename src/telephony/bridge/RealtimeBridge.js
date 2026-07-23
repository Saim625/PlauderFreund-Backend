// src/telephony/bridge/RealtimeBridge.js
import EventEmitter from "events";
import {
  decodeMulawTo24kPcm,
  encode24kPcmToMulaw,
} from "../utils/AudioResampler.js";

export class TelephonySocketAdapter extends EventEmitter {
  constructor(channelId, externalMedia, rtpSender) {
    super();
    this.id = `telephony_${channelId}`;
    this.externalMedia = externalMedia;
    this.rtpSender = rtpSender;

    // Listen to incoming 8kHz µ-law audio from Asterisk via UDP
    if (this.externalMedia) {
      this.externalMedia.on("audio", (mulawBuffer) => {
        // Upsample 8kHz µ-law to 24kHz PCM for OpenAI
        const pcm24k = decodeMulawTo24kPcm(mulawBuffer);

        // Emit 'audio-chunk' exactly as expected by realtimeHandler
        this.emit("audio-chunk", pcm24k.toString("base64"));
      });
    }
  }

  /**
   * Mocks socket.emit() from Socket.IO
   */
  emit(event, data) {
    // Intercept outgoing AI audio from ElevenLabs / OpenAI
    if (event === "ai-audio-chunk" && data?.audio) {
      const pcm24k = Buffer.from(data.audio, "base64");

      // Downsample 24kHz PCM -> 8kHz µ-law for Asterisk
      const mulawBuffer = encode24kPcmToMulaw(pcm24k);

      if (this.rtpSender) {
        this.rtpSender.sendMulaw(mulawBuffer);
      }
      return true;
    }

    // Standard internal events pass through
    return super.emit(event, data);
  }
}
