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
    this._pendingDoneContext = null;
    this._gptForwardTimer = setInterval(() => {
      if (this._gptChunksForwarded === 0) return;
      this._gptChunksForwarded = 0;
    }, 10000);

    if (this.externalMedia) {
      this.externalMedia.on("audio", (mulawBuffer) => {
        const pcm24k = decodeMulawTo24kPcm(mulawBuffer);

        if (!this._firstAudioForwarded) {
          this._firstAudioForwarded = true;
        }

        this.emit("audio-chunk", pcm24k);
        this._gptChunksForwarded++;
      });
    }

    console.log("RTPSender exists:", !!this.rtpSender);
  }

  emit(event, data) {
    if (event === "ai-audio-chunk" && data?.audio) {
      const pcm24k = Buffer.from(data.audio, "base64");
      const mulawBuffer = encode24kPcmToMulaw(pcm24k);

      if (this.rtpSender) {
        this.rtpSender.sendAudio(mulawBuffer);
      }
      return true;
    }

    if (event === "ai-interrupt") {
      this._pendingDoneContext = null;
      this.rtpSender?.clearQueue();
      return super.emit(event, data);
    }

    if (event === "ai-audio-complete" && data?.contextId) {
      const { contextId } = data;

      if (this._pendingDoneContext === contextId) {
        return true;
      }
      this._pendingDoneContext = contextId;

      if (this.rtpSender) {
        this.rtpSender.flush();
        this.rtpSender.whenIdle(() => {
          if (this._pendingDoneContext !== contextId) return;
          this._pendingDoneContext = null;
          super.emit("ai-audio-done", { contextId });
        });
      } else {
        super.emit("ai-audio-done", { contextId });
      }

      return true;
    }

    return super.emit(event, data);
  }

  destroy() {
    clearInterval(this._gptForwardTimer);
    this.rtpSender?.clearQueue();
    this.connected = false;
  }
}
