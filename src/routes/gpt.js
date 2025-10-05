// src/routes/gpt.js
import express from "express";
// import { generateReply } from "../services/gptService.js";

const router = express.Router();

router.post("/gpt-test", async (req, res) => {
  try {
    const { text } = req.body;
    const reply = await generateReply(text);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: "GPT failed" + err.message });
  }
});

export default router;
