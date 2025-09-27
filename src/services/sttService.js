import axios from "axios";
import FormData from "form-data";
import { OPENAI_BASE_URL, OPENAI_API_KEY } from "../config/env.js";
import logger from "../utils/logger.js";

export async function transcribeAudio(audioBuffer) {
  try {
    const formData = new FormData();
    formData.append("file", audioBuffer, "intro.mp3"); // field name must be "file"
    formData.append("model", "whisper-1");

    const response = await axios.post(
      `${OPENAI_BASE_URL}/audio/transcriptions`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          ...formData.getHeaders(), // handles Content-Type
        },
      }
    );

    return response.data.text;
  } catch (err) {
    logger.error(
      `❌ STT Error: ${err.response?.data?.error?.message || err.message}`
    );
    throw new Error("Speech-to-text failed");
  }
}
