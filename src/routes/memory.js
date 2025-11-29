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
  const { token, text } = req.body;
  if (!token || !text)
    return res
      .status(400)
      .json({ success: false, message: "Token and text required" });

  const prompt = `
You are a memory extraction system designed to identify useful long-term information from a chat session. 
This information is critical for maintaining context in future interactions.

The conversation is formatted with speaker roles (USER: and ASSISTANT:).

### Important Rule:
- **USER messages** are the only source of truth.
- **ASSISTANT messages** are included ONLY to give context to the conversation. 
  Never extract or assume facts based solely on what the assistant says.

### Extraction Guidelines:

1. **Target Facts:** Extract information that reveals something:
   * **About the USER:** personal details (name, age, location, family, profession, background),
     preferences (likes, dislikes, hobbies, habits), goals, current activities, emotional state, or personality traits.
   * **About the ASSISTANT:** any name, personality, or traits the USER explicitly assigns to it 
     (e.g., “Your name is Polo”, “Be my mentor”, “Act like a friend”, etc.)

2. **Ignore:** Anything said by the ASSISTANT unless it directly confirms or repeats a USER statement. 
   Do not extract or modify facts based only on the ASSISTANT’s words.

3. **Output Format:** 
   Return a clean JSON array of objects, each with:
   - "category": "Personal" | "Preference" | "Goal" | "Personality" | "Identity"
   - "key"
   - "value"

4. **Category Rules:**
   * Facts about the USER → one of "Personal", "Preference", "Goal", "Personality"
   * Facts about the ASSISTANT (given by USER) → use "Identity"
     Example keys: "assistant_name", "assistant_role", "assistant_personality"

5. **Do NOT invent or infer information not clearly given by the USER.**

Conversation History:
"""${text}"""`;

  const gptResponse = await getGPTResponse([{ role: "user", content: prompt }]);
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
  try {
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
