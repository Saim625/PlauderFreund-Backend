import express from "express";
import { updateMemorySummary } from "../controllers/memoryController.js";
import MemorySummary from "../models/MemorySummary.js";

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
