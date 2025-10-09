// src/services/realtimeService.js
import WebSocket from "ws";
import logger from "../utils/logger.js";
import { OPENAI_API_KEY, OPENAI_REALTIME_API } from "../config/env.js";

export async function connectToRealtimeAPI() {
  // 🔗 1️⃣ Connect directly to GPT Realtime model
  const ws = new WebSocket(`${OPENAI_REALTIME_API}`, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
  });

  // 🔊 2️⃣ When connected
  ws.on("open", () => {
    logger.info("✅ Connected to GPT Realtime API");

    // 💬 Initial session setup (tone and behavior)
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model: "gpt-4o-realtime-preview", // adjust if you have a different model name
          output_modalities: ["audio"],
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              turn_detection: { type: "semantic_vad" },
            },
            output: {
              format: { type: "audio/pcm" }, // model will stream raw PCM in output deltas
              voice: "alloy", // choose from available voices
            },
          },
          instructions:
            "You are a kind and patient assistant designed to help elderly users. \
            Speak clearly, slowly, and with empathy. \
            Avoid using technical or complex language. \
            If the user sounds confused, gently clarify what they might mean.",
        },
      })
    );
  });
  // 🧠 3️⃣ Log any incoming GPT events
  ws.on("message", (msg) => {
    try {
      const event = JSON.parse(msg.toString());
      //   logger.info("📩 GPT Event:", event);
    } catch (err) {
      logger.error("❌ Error parsing GPT message:", err);
    }
  });

  ws.on("error", (err) => {
    logger.error("❌ GPT WS Error:", err);
  });

  ws.on("close", () => {
    logger.info("⚠️ GPT Realtime WebSocket closed.");
  });

  return ws;
}
