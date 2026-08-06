import axios from "axios";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MODEL,
  ELEVENLABS_VOICE_ID,
} from "../config/env.js";

export async function generateGreetingAudio(
  text,
  voiceConfig,
  { outputFormat = "pcm_24000" } = {},
) {
  const response = await axios({
    method: "post",
    url: `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceConfig.voiceId}?output_format=${outputFormat}`,
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: outputFormat === "ulaw_8000" ? "audio/basic" : "audio/pcm",
    },
    data: {
      text,
      model_id: `${ELEVENLABS_MODEL}`,
      voice_settings: {
        // Use the same values as your multi-context API setup for consistency
        stability:
          voiceConfig.empathyLevel === "high"
            ? 0.35
            : voiceConfig.empathyLevel === "medium"
            ? 0.55
            : 0.75,
        similarity_boost: 0.8,

        // use_speaker_boost is not usually needed here unless you explicitly use it elsewhere
      },
    },
    responseType: "arraybuffer",
  });

  return Buffer.from(response.data);
}
