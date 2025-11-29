import express from "express";
import MemorySummary from "../models/MemorySummary.js";
import { getGPTResponse } from "../services/gptService.js";
import { generateGreetingAudio } from "../services/generateGreetingAudio.js";
import { greetingStore } from "../state/greetingStore.js";

export const greetingRouter = express.Router();

greetingRouter.post("/generate-greeting", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const memory = await MemorySummary.findOne({ token });
    const summary = memory?.summary || "a new user";

    const prompt = [
      {
        role: "system",
        content: `You are a warm, friendly AI assistant who speaks directly to the user like a real human in german.
        Your job is to create a completely unique greeting every time — never generic, never robotic.
        Use the users personality and biography and find name from biography and use it in greeting to make the greeting personal and meaningful.
        Keep it 1-2 short conversational sentences. No lists, no emojis, no quotes.`,
      },
      {
        role: "user",
        content: `
        User Biography:
        ${summary || "No biography yet"}

        Create the greeting now.
        `,
      },
    ];

    const greetingText = await getGPTResponse(prompt);
    console.log("greetin", greetingText);

    greetingStore.set(token, greetingText);

    const audioBuffer = await generateGreetingAudio(greetingText);

    // Convert to Base64
    const base64Audio = audioBuffer.toString("base64");

    res.status(200).json({ text: greetingText, audio: base64Audio });
  } catch (err) {
    console.error("Error generating greeting:", err);
    res.status(500).json({ error: err.message });
  }
});
