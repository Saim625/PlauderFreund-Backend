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
    this.connected = true;
    this._firstAudioForwarded = false;
    this._gptChunksForwarded = 0;
    this._gptForwardTimer = setInterval(() => {
      if (this._gptChunksForwarded === 0) return;
      console.log(
        `📊 [${this.id}] forwarded ${this._gptChunksForwarded} PCM chunks to GPT (last 10s)`,
      );
      this._gptChunksForwarded = 0;
    }, 10000);

    if (this.externalMedia) {
      this.externalMedia.on("audio", (mulawBuffer) => {
        const pcm24k = decodeMulawTo24kPcm(mulawBuffer);

        if (!this._firstAudioForwarded) {
          this._firstAudioForwarded = true;
          console.log(
            `✅ [${this.id}] First caller audio converted (${mulawBuffer.length}B µ-law → ${pcm24k.length}B PCM24k)`,
          );
        }

        // Match web client: raw PCM bytes (Buffer), not a base64 string
        this.emit("audio-chunk", pcm24k);
        this._gptChunksForwarded++;
      });
    }
  }

  /**
   * Mocks socket.emit() from Socket.IO
   */
  emit(event, data) {
    if (event === "ai-audio-chunk" && data?.audio) {
      const pcm24k = Buffer.from(data.audio, "base64");
      const mulawBuffer = encode24kPcmToMulaw(pcm24k);

      if (this.rtpSender) {
        this.rtpSender.sendAudio(mulawBuffer);
      }
      return true;
    }

    if (event === "ai-audio-complete" && data?.contextId) {
      // Telephony has no browser playback ack — simulate it for context cleanup
      setTimeout(() => {
        super.emit("ai-audio-done", { contextId: data.contextId });
      }, 150);
      return true;
    }

    return super.emit(event, data);
  }

  destroy() {
    clearInterval(this._gptForwardTimer);
    this.connected = false;
  }
}
