import MemorySummary from "../models/MemorySummary.js";

/**
 * Reusable function to update or create memory summary
 */
export async function updateMemorySummary(token, newInsights) {
  if (!token) throw new Error("Token required");

  let memory = await MemorySummary.findOne({ token });

  if (!memory) {
    // Convert any arrays/objects to strings
    const cleanedInsights = newInsights.map((insight) => ({
      ...insight,
      value:
        Array.isArray(insight.value) || typeof insight.value === "object"
          ? JSON.stringify(insight.value)
          : insight.value,
    }));

    memory = new MemorySummary({ token, summary: cleanedInsights });
  } else {
    newInsights.forEach((insight) => {
      // Convert arrays/objects before saving
      const safeValue =
        Array.isArray(insight.value) || typeof insight.value === "object"
          ? JSON.stringify(insight.value)
          : insight.value;

      const existing = memory.summary.find((s) => s.key === insight.key);
      if (existing) existing.value = safeValue;
      else memory.summary.push({ ...insight, value: safeValue });
    });
  }

  memory.updatedAt = new Date();
  await memory.save();
  return memory;
}
