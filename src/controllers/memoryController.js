import MemorySummary from "../models/MemorySummary.js";

/**
 * Reusable function to update or create memory summary
 */
export async function updateMemorySummary(token, newInsights) {
  console.log("Indights: ", newInsights);
  if (!token) throw new Error("Token required");

  let memory = await MemorySummary.findOne({ token });

  if (!memory) {
    // Convert any arrays/objects to strings
    const cleanedInsights = newInsights.map((insight) => {
      const { _id, ...safeInsight } = insight; // 🔥 remove GPT id
      return {
        ...safeInsight,
        value:
          Array.isArray(safeInsight.value) ||
          typeof safeInsight.value === "object"
            ? JSON.stringify(safeInsight.value)
            : safeInsight.value,
      };
    });
    memory = new MemorySummary({ token, summary: cleanedInsights });
  } else {
    newInsights.forEach((insight) => {
      const { _id, ...safeInsight } = insight; // 🔥 delete GPT id

      const safeValue =
        Array.isArray(safeInsight.value) ||
        typeof safeInsight.value === "object"
          ? JSON.stringify(safeInsight.value)
          : safeInsight.value;

      const existing = memory.summary.find((s) => s.key === safeInsight.key);
      if (existing) {
        existing.value = safeValue;
        existing.lastUpdated = new Date();
      } else {
        memory.summary.push({ ...safeInsight, value: safeValue });
      }
    });
  }

  memory.updatedAt = new Date();
  await memory.save();
  return memory;
}
