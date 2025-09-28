import axios from "axios";
import {
  ELEVENLABS_API_KEY,
  ELEVENLABS_BASE_URL,
  ELEVENLABS_VOICE_ID,
} from "../config/env.js";
import fs from "fs";
import logger from "../utils/logger.js";

export async function synthesizeSpeech(text, outputFile = "reply.mp3") {
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

    // Save for testing
    fs.writeFileSync(outputFile, res.data);
    logger.info(`🔊 TTS audio saved as ${outputFile}`);

    return res.data; // raw audio buffer
  } catch (err) {
    logger.error(
      `❌ ElevenLabs TTS Error: ${err.response?.data?.error || err.message}`
    );
    throw new Error("TTS generation failed");
  }
}
