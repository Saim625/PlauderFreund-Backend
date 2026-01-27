import prisma from "../lib/db.js";
import { updateMemorySummary } from "../controllers/memoryController.js";
import { getGPTResponse } from "./gptService.js";

export async function flushConversationToMemory(token) {
  console.log("🧠 Flushing conversation to memory:", token);

  const convo = await prisma.conversation.findUnique({
    where: { token },
    include: { messages: true },
  });
  
  if (!convo || !convo.messages.length) return;

  // 1️⃣ Get unprocessed messages
  const unprocessed = convo.messages.filter((m) => !m.processed);
  if (!unprocessed.length) return;

  // 2️⃣ Build conversation text
  const conversationText = unprocessed
    .map((m) =>
      m.role === "user" ? `USER: ${m.text}` : `ASSISTANT: ${m.text}`
    )
    .join("\n");

  const existingFacts = await prisma.memorySummary.findUnique({
    where: { token },
    include: { summary: true },
  });

  const prompt = `
You are a memory extraction system designed to update a user's long-term memory.

You are given:
1) The user's EXISTING memory
2) A NEW conversation

Your job is to return ONLY facts that are:
• New (not in memory yet)
• Or if value is updated of existing fact (same key but different value)

DO NOT repeat facts that already exist and are unchanged.
DO NOT rewrite or summarize the full memory.

The conversation is formatted with speaker roles (USER: and ASSISTANT:).

### Important Rules:
- **USER messages** are the only source of truth.
- **ASSISTANT messages** are included ONLY for context.
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

5. **Do NOT invent, guess, or infer information not clearly stated by the USER.**

6. If the conversation does not contain any new or changed information, return an empty JSON array: [].

---

### EXISTING MEMORY:
"""${JSON.stringify(existingFacts?.summary || [])}"""

### NEW CONVERSATION:
"""${conversationText}"""
`;

  // 4️⃣ Ask GPT
  const raw = await getGPTResponse([{ role: "user", content: prompt }]);
  if (!raw) return;

  let facts;
  try {
    facts = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (err) {
    console.error("❌ GPT JSON parse failed:", raw);
    return;
  }

  // 5️⃣ Save memory
  await updateMemorySummary(token, facts);

  // 6️⃣ Mark messages as processed and delete them
  const unprocessedMessageIds = unprocessed.map((m) => m.id);
  await prisma.message.deleteMany({
    where: {
      id: { in: unprocessedMessageIds },
    },
  });

  console.log(`✅ ${facts.length} facts stored & messages marked processed`);
}
