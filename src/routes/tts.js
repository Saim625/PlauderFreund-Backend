import express from "express";
// import { synthesizeSpeech } from "../services/ttsService.js";
const router = express.Router();

router.post("/tts-test", async (req, res) => {
  try {
    const { text } = req.body;
    const audioBuffer = await synthesizeSpeech(text, "test.mp3");
    res.set("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: "TTS failed" });
  }
});

export default router;
