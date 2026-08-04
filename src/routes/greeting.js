import express from "express";
import { generateGreeting } from "../services/GreetingService";

export const greetingRouter = express.Router();

const MAX_GREETING_HISTORY = 3;

greetingRouter.post("/generate-greeting", async (req, res) => {
  try {
    const { text, audioBuffer } = await generateGreeting(token);

    res.json({
      text,
      audio: audioBuffer.toString("base64"),
    });
  } catch (err) {
    console.error("Error generating greeting:", err);
    res.status(500).json({ error: err.message });
  }
});
