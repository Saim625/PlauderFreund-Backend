import axios from "axios";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_VOICE_ID,
} from "../config/env.js";
// import fs from "fs"; // Removed: We don't need to save the file
import logger from "../utils/logger.js"; // Corrected logger import

export async function synthesizeTTS(text) {
  try {
    const res = await axios.post(
      `${ELEVENLABS_BASE_URL}/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.7,
        },
      },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    );

    // logger.info(`🔊 TTS audio generated.`); // Logging the size happens in socketHandler

    // Axios returns ArrayBuffer for 'arraybuffer' responseType,
    // which Node.js treats as a Buffer when returning it.
    return res.data;
  } catch (err) {
    logger.error(
      `❌ ElevenLabs TTS Error: ${err.response?.data?.error || err.message}`
    );
    throw new Error("TTS generation failed");
  }
}
