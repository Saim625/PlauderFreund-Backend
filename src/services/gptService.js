import axios from "axios";
import { OPENAI_API_KEY, OPENAI_BASE_URL } from "../config/env.js";
import logger from "../utils/logger.js";

export async function generateReply(transcript) {
  try {
    const res = await axios.post(
      `${OPENAI_BASE_URL}/chat/completions`,
      {
        model: "gpt-5",
        messages: [
          //   {
          //     role: "system",
          //     content: "You are a helpful AI assistant. Always reply in German.",
          //   },
          { role: "user", content: transcript },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const aiReply = res.data.choices[0].message.content;
    logger.info(`🤖 GPT Reply: ${aiReply}`);
    return aiReply;
  } catch (err) {
    logger.error(
      `❌ GPT Error: ${err.response?.data?.error?.message || err.message}`
    );
    throw new Error("GPT generation failed");
  }
}
