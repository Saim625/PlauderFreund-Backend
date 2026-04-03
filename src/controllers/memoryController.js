import prisma from "../lib/db.js";

/**
 * Reusable function to update or create memory summary
 */
export async function updateMemorySummary(token, newInsights) {
  try {
    if (!token) throw new Error("Token required");

    let memory = await prisma.memorySummary.findUnique({
      where: { token },
      include: { summary: true },
    });

    if (!memory) {
      // Convert any arrays/objects to strings
      const cleanedInsights = newInsights.map((insight) => {
        const { id, ...safeInsight } = insight; // Remove any id fields
        return {
          ...safeInsight,
          value:
            Array.isArray(safeInsight.value) ||
            typeof safeInsight.value === "object"
              ? JSON.stringify(safeInsight.value)
              : String(safeInsight.value),
        };
      });

      // Create memory summary with items
      memory = await prisma.memorySummary.create({
        data: {
          token,
          summary: {
            create: cleanedInsights,
          },
        },
        include: { summary: true },
      });
    } else {
      // Update existing memory
      for (const insight of newInsights) {
        const { id, ...safeInsight } = insight;

        const safeValue =
          Array.isArray(safeInsight.value) ||
          typeof safeInsight.value === "object"
            ? JSON.stringify(safeInsight.value)
            : String(safeInsight.value);

        const existing = memory.summary.find((s) => s.key === safeInsight.key);

        if (existing) {
          // Update existing item
          await prisma.memorySummaryItem.update({
            where: { id: existing.id },
            data: {
              value: safeValue,
              lastUpdated: new Date(),
            },
          });
        } else {
          // Create new item
          await prisma.memorySummaryItem.create({
            data: {
              category: safeInsight.category,
              key: safeInsight.key,
              value: safeValue,
              memorySummaryId: memory.id,
            },
          });
        }
      }

      // Update memory timestamp
      memory = await prisma.memorySummary.update({
        where: { id: memory.id },
        data: { updatedAt: new Date() },
        include: { summary: true },
      });
    }

    return memory;
  } catch (err) {
    console.log("Err in Memory Controller", err.message);
  }
}
