import express from "express";
import { updateMemorySummary } from "../controllers/memoryController.js";
import MemorySummary from "../models/MemorySummary.js";
import { getGPTResponse } from "../services/gptService.js"; // hypothetical GPT service

export const memoryRouter = express.Router();

// ✅ Get memory summary
memoryRouter.get("/", async (req, res) => {
  const { token } = req.query;
  if (!token)
    return res.status(400).json({ success: false, message: "Token required" });

  const memory = await MemorySummary.findOne({ token });
  if (!memory) return res.json({ success: true, data: [] });

  res.json({ success: true, data: memory.summary });
});

// ✅ Update memory summary
memoryRouter.post("/update", async (req, res) => {
  try {
    const { token, newInsights } = req.body;
    if (!token)
      return res
        .status(400)
        .json({ success: false, message: "Token required" });

    await updateMemorySummary(token, newInsights);
    res.json({ success: true, message: "Memory updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ Summarize (extract insights from GPT and update memory)
// ✅ Summarize (extract insights from GPT and update memory)
memoryRouter.post("/summarize", async (req, res) => {
  console.log("🧠 Summarize endpoint hit!");
  console.log("📦 Request body:", req.body);

  try {
    const { token, text } = req.body;
    if (!token || !text)
      return res
        .status(400)
        .json({ success: false, message: "Token and text required" });

    const prompt = `
You are a memory extraction system designed to identify useful long-term information about a user from a chat session.

Analyze the following user messages and extract only meaningful facts that help the assistant know the user better in future conversations.

Focus ONLY on information that reveals something *about the user*, such as:
- personal details (name, age, location, family, profession)
- preferences (likes, dislikes, hobbies, habits)
- goals, current activities, or projects
- emotional state or general personality traits

Ignore small talk, greetings, humor, or anything temporary (like “I’m busy right now”).
Do NOT create unnecessary or invented categories.
Skip any assistant replies or context.

Return the result as a clean JSON array:
[
  { "key": "name", "value": "Ali" },
  { "key": "interest", "value": "coding" }
]

User Messages:
"""${text}"""
`;

    const gptResponse = await getGPTResponse([
      { role: "user", content: prompt },
    ]);
    let cleaned = gptResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let newInsights = [];
    try {
      newInsights = JSON.parse(cleaned);
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to parse GPT summary",
        raw: gptResponse,
      });
    }

    const updatedMemory = await updateMemorySummary(token, newInsights);

    res.json({
      success: true,
      message: "Memory summarized and updated",
      data: updatedMemory.summary,
    });
  } catch (error) {
    console.error("❌ Summarization failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});
