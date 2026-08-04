import express from "express";
import { generateGreeting } from "../services/GreetingService.js";

export const greetingRouter = express.Router();

greetingRouter.post("/generate-greeting", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

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
