// src/routes/stt.js
import express from "express";
import multer from "multer";
// import { transcribeAudio } from "../services/sttService.js";

const upload = multer(); // memory storage by default
const router = express.Router();

router.post("/stt-test", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const transcript = await transcribeAudio(req.file.buffer);
    res.json({ transcript });
  } catch (err) {
    res.status(500).json({ error: "STT failed", details: err.message });
  }
});

export default router;
