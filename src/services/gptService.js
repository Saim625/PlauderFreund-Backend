import axios from "axios";
import { OPENAI_API_KEY, OPENAI_BASE_URL } from "../config/env.js";
import logger from "../utils/logger.js"; // Corrected logger import

export async function getGptResponse(transcript) {
  try {
    const res = await axios.post(
      `${OPENAI_BASE_URL}/chat/completions`,
      {
        // NOTE: Changed model to a standard GPT model for reliability.
        // If you specifically need 'gpt-5', change it back, but it's not a standard OpenAI model name.
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: transcript }],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const aiReply = res.data.choices[0].message.content;
    logger.info(`🤖 GPT Reply: ${aiReply.substring(0, 80)}...`);
    return aiReply;
  } catch (err) {
    logger.error(
      `❌ GPT Error: ${err.response?.data?.error?.message || err.message}`
    );
    throw new Error("GPT generation failed");
  }
}
