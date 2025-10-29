// src/services/realtimeService.js
import WebSocket from "ws";
import logger from "../utils/logger.js";
import { OPENAI_API_KEY, OPENAI_REALTIME_API } from "../config/env.js";

/**
 * Connect to OpenAI Realtime API
 * @param {Array|string} [summary=[]] - Optional memory/context from DB
 * @returns {Promise<WebSocket>}
 */
export async function connectToRealtimeAPI(summary = []) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${OPENAI_REALTIME_API}`, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    });

    ws.on("open", () => {
      logger.info("✅ Connected to GPT Realtime API");

      // 🧠 Build memory context
      const memoryText =
        Array.isArray(summary) && summary.length
          ? summary.map((item) => `• ${item}`).join("\n")
          : "No prior memory available.";

      // 💬 Initial session setup
      const sessionConfig = {
        type: "session.update",
        session: {
          type: "realtime",
          model: "gpt-4o-realtime-preview",
          output_modalities: ["text"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              turn_detection: { type: "semantic_vad" },
              transcription: { model: "whisper-1" },
            },
          },
          // 🧩 Context-aware system prompt
          instructions: `
You are a kind, patient assistant designed to help elderly German users.
Speak clearly, slowly, and with empathy. Avoid complex or technical words.
If the user sounds confused, gently clarify what they might mean.

Here is the user's previous memory/context:
${memoryText}
          `.trim(),
        },
      };

      ws.send(JSON.stringify(sessionConfig));
      resolve(ws);
    });

    ws.on("message", (msg) => {
      try {
        const event = JSON.parse(msg.toString());
        // logger.info("📩 GPT Event:", event);
      } catch (err) {
        logger.error("❌ Error parsing GPT message:", err);
      }
    });

    ws.on("error", (err) => {
      logger.error("❌ GPT WS Error:", err);
      reject(err);
    });

    ws.on("close", () => {
      logger.info("⚠️ GPT Realtime WebSocket closed.");
    });
  });
}
