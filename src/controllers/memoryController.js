import MemorySummary from "../models/MemorySummary.js";

/**
 * Reusable function to update or create memory summary
 */
export async function updateMemorySummary(token, newInsights) {
  if (!token) throw new Error("Token required");

  let memory = await MemorySummary.findOne({ token });

  if (!memory) {
    memory = new MemorySummary({ token, summary: newInsights });
  } else {
    // merge or append insights
    newInsights.forEach((insight) => {
      const existing = memory.summary.find((s) => s.key === insight.key);
      if (existing) existing.value = insight.value;
      else memory.summary.push(insight);
    });
  }

  memory.updatedAt = new Date();
  await memory.save();
  return memory;
}
