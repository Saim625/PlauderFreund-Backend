import prisma from "../lib/db.js";
import { updateMemorySummary } from "../controllers/memoryController.js";
import { getGPTResponse } from "./gptService.js";
import { parseAndSaveReminders } from "./reminderService.js"; // no longer calls GPT

export async function flushConversationToMemory(token, timezone) {
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
      m.role === "user" ? `USER: ${m.text}` : `ASSISTANT: ${m.text}`,
    )
    .join("\n");

  const existingFacts = await prisma.memorySummary.findUnique({
    where: { token },
    include: { summary: true },
  });

  const safeTimezone = timezone && timezone !== "undefined" ? timezone : "UTC";
  const now = new Date();

  // 3️⃣ Single combined prompt — facts + reminders in one GPT call
  const prompt = `
You are a memory and reminder extraction system for a voice assistant.

You are given:
1) The user's EXISTING memory (facts already known)
2) A NEW conversation

Your job is to return a JSON object with exactly two keys: "facts" and "reminders".

---

## PART 1 — FACTS

Extract only important, lasting facts about the user.

### Rules:
- Only extract from USER messages. ASSISTANT messages are context only.
- Do NOT extract reminders, tasks, appointments, or anything time-sensitive into facts.
- Do NOT repeat facts that already exist and are unchanged.
- Do NOT invent or infer anything not clearly stated by the user.
- Only extract facts that are genuinely useful to remember long-term.

### What qualifies as a fact:
- Personal details: name, age, location, family members, profession, health conditions
- Preferences: likes, dislikes, hobbies, habits, food, language
- Goals: things the user wants to achieve or is working toward
- Personality traits explicitly mentioned
- Identity assigned to the assistant (name, role, personality)

### What does NOT qualify as a fact:
- One-off statements ("I'm tired today")
- Reminders or appointments ("I have a doctor appointment Friday")
- Medication schedules or tasks
- Anything already in existing memory unchanged

### Facts output format (array of objects):
- "category": "Personal" | "Preference" | "Goal" | "Personality" | "Identity"
- "key": short snake_case key
- "value": the extracted value

If no new or changed facts, return empty array [].

---

## PART 2 — REMINDERS

Extract anything the user mentioned that is a future task, appointment, medication, birthday, or time-sensitive event.

### TIME CONTEXT
- Current UTC Time: ${now.toISOString()}
- User Timezone: ${safeTimezone}
- User Local Time: ${now.toLocaleString("en-US", { timeZone: safeTimezone })}

All datetime fields must be ISO 8601 with correct offset for "${safeTimezone}". Never use UTC offset for user times.

### Rules:
- Only extract from USER messages.
- Do NOT invent details not clearly stated.
- If a field cannot be determined, use null.

### remind_from / remind_until guidelines:
- medication  → remind_from: 60 min before event_datetime, remind_until: 720 min after
- appointment → remind_from: 24 hours before event_datetime, remind_until: end of event day
- birthday    → remind_from: 48 hours before event_datetime, remind_until: end of event day
- general     → remind_from: now, remind_until: null

### Recurrence rules (apply these defaults per category):
- medication  → "daily" by default unless user says otherwise
- appointment → "none" unless user says it repeats
- birthday    → "yearly" always
- general     → "none" unless user says it repeats

### recurrence values: "none" | "daily" | "weekly" | "yearly"

### Reminders output format (array of objects):
- "title": short clear title
- "description": extra context or null
- "reminder_type": "medication" | "appointment" | "birthday" | "general"
- "event_datetime": ISO8601 with offset or null
- "remind_from": ISO8601 with offset or null
- "remind_until": ISO8601 with offset or null
- "recurrence": "none" | "daily" | "weekly" | "yearly"

If no reminders found, return empty array [].

---

## FINAL OUTPUT FORMAT
Return ONLY this JSON. No explanation, no markdown:

{
  "facts": [...],
  "reminders": [...]
}

---

### EXISTING MEMORY:
"""${JSON.stringify(existingFacts?.summary || [])}"""

### NEW CONVERSATION:
"""${conversationText}"""
`;

  // 4️⃣ Single GPT call
  const raw = await getGPTResponse([{ role: "user", content: prompt }]);
  if (!raw) return;

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (err) {
    console.error("❌ GPT JSON parse failed:", raw);
    return;
  }

  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];

  // 5️⃣ Save facts
  if (facts.length > 0) {
    await updateMemorySummary(token, facts);
    console.log(`✅ ${facts.length} facts stored`);
  } else {
    console.log("ℹ️ No new facts to store");
  }

  // 6️⃣ Delete processed messages
  const unprocessedMessageIds = unprocessed.map((m) => m.id);
  await prisma.message.deleteMany({
    where: { id: { in: unprocessedMessageIds } },
  });

  // 7️⃣ Save reminders (no GPT call — just parse + upsert)
  try {
    await parseAndSaveReminders(token, reminders);
  } catch (err) {
    console.error("❌ Reminder save failed (non-fatal):", err.message);
  }
}
