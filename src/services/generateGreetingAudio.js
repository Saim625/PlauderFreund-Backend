import axios from "axios";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MODEL,
  ELEVENLABS_VOICE_ID,
} from "../config/env.js";

export async function generateGreetingAudio(text) {
  const response = await axios({
    method: "post",
    url: `${ELEVENLABS_BASE_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=pcm_24000`,
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/pcm",
    },
    data: {
      text,
      model_id: `${ELEVENLABS_MODEL}`,
      voice_settings: {
        // Use the same values as your multi-context API setup for consistency
        stability: 0.5,
        similarity_boost: 0.8,
        // use_speaker_boost is not usually needed here unless you explicitly use it elsewhere
      },
    },
    responseType: "arraybuffer",
  });

  return Buffer.from(response.data);
}
