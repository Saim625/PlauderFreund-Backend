// adapters/TelephonyAdapter.js
import EventEmitter from "events";
import {
  encode24kPcmToMulaw,
  decodeMulawTo24kPcm,
} from "../utils/AudioResampler.js";

export class TelephonySocketAdapter extends EventEmitter {
  constructor(callId, externalMedia) {
    super();
    this.id = `telephony_${callId}`;
    this.externalMedia = externalMedia;

    // Receive 8kHz µ-law audio from Asterisk via ExternalMedia
    this.externalMedia.on("audio", (mulawBuffer) => {
      console.log("🎤 TelephonySocketAdapter received audio");

      // Upsample 8kHz µ-law to 24kHz PCM for OpenAI
      const pcm24k = decodeMulawTo24kPcm(mulawBuffer);

      // Emit as base64 chunk matching the exact format realtimeHandler expects from Web clients
      this.emit("audio-chunk", pcm24k.toString("base64"));
      console.log("📤 Sending audio-chunk to realtimeHandler");
    });
  }

  /**
   * Mocks Socket.IO's socket.emit()
   * Intercepts outgoing audio chunks emitted by elevenlabWs / realtimeHandler
   */
  emit(event, data) {
    // 1. Intercept AI audio chunks from ElevenLabs / OpenAI
    if (event === "ai-audio-chunk" && data?.audio) {
      const pcm24k = Buffer.from(data.audio, "base64");

      // Downsample 24kHz PCM to 8kHz µ-law
      const mulawBuffer = encode24kPcmToMulaw(pcm24k);

      // Stream directly back to Asterisk over UDP RTP
      this.externalMedia.sendAudio(mulawBuffer);
      return true;
    }

    // 2. Pass standard internal events through normal EventEmitter
    return super.emit(event, data);
  }
}
