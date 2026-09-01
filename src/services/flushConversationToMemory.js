import prisma from "../lib/db.js";
import { updateMemorySummary } from "../controllers/memoryController.js";
import { getGPTResponse } from "./gptService.js";
import { parseAndSaveReminders } from "./reminderService.js"; // no longer calls GPT
import { addChatTokens } from "./usageTracker.js";

// A Conversation is shared by all sessions of one user. Serializing flushes
// prevents two near-simultaneous disconnects from extracting the same messages.
const flushLocks = new Map();

async function acquireFlushLock(token) {
  const previous = flushLocks.get(token) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  flushLocks.set(token, queued);
  await previous;

  return () => {
    release();
    if (flushLocks.get(token) === queued) flushLocks.delete(token);
  };
}

export async function flushConversationToMemory(
  token,
  timezone,
  sessionId,
  chatModel = "gpt-4o-mini",
) {
  const releaseFlushLock = await acquireFlushLock(token);
  try {
    console.log("🧠 Flushing conversation to memory:", token);
    const convo = await prisma.conversation.findUnique({
      where: { token },
      include: { messages: true },
    });

    if (!convo || !convo.messages.length) return;

    // 1️⃣ Get unprocessed messages
    const unprocessed = convo.messages.filter((m) => !m.processed);
    if (!unprocessed.length) return;

    // Reminder and fact extraction must never see assistant messages. Reminder
    // deliveries are spoken by the assistant and would otherwise re-enter the
    // database when the session is flushed.
    const userConversationText = unprocessed
      .filter((m) => m.role === "user")
      .map((m) => `USER: ${m.text}`)
      .join("\n");

    if (!userConversationText.trim()) {
      await prisma.message.deleteMany({
        where: { id: { in: unprocessed.map((m) => m.id) } },
      });
      return;
    }

    const existingFacts = await prisma.memorySummary.findUnique({
      where: { token },
      include: { summary: true },
    });
    const activeReminders = await prisma.reminder.findMany({
      where: { userToken: token, status: "active" },
      select: {
        id: true,
        title: true,
        description: true,
        reminderType: true,
        eventDatetime: true,
        recurrence: true,
      },
      orderBy: { id: "asc" },
    });

    const safeTimezone =
      timezone && timezone !== "undefined" ? timezone : "UTC";
    const now = new Date();

    // 3️⃣ Single combined prompt — facts + reminders in one GPT call
    const prompt = `
You are a memory and reminder extraction system for a voice assistant.

You are given:
1) The user's EXISTING memory (facts already known)
2) The user's active reminders
3) NEW user messages only (assistant messages are intentionally excluded)

Your job is to return a JSON object with exactly three keys: "facts", "reminders", and "session_summary".

---

## PART 1 — FACTS

Extract only important, lasting facts about the user.

### Rules:
- Only extract from USER messages. ASSISTANT messages are context only.
- If a fact only appears because the assistant mentioned it — do NOT extract it
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
- Current local date and time: ${now.toLocaleString("en-US", { timeZone: safeTimezone })}
- Current weekday: ${now.toLocaleDateString("en-US", { timeZone: safeTimezone, weekday: "long" })}

All datetime fields must be ISO 8601 with correct offset for "${safeTimezone}".

### CRITICAL RULES — READ CAREFULLY:

**event_datetime is MANDATORY for all types of reminders.**
**remind_from and remind_until are MANDATORY whenever event_datetime is known.**

You MUST calculate datetimes — never leave them null when there is any time information available.

### CRITICAL — DO NOT EXTRACT FROM ASSISTANT MESSAGES:
- The input contains USER messages only. Never create a reminder from an
  acknowledgement, confirmation, or vague follow-up such as "yes", "okay",
  "I know", or "I took it".
- Compare every explicit reminder request with ACTIVE REMINDERS below.
- If it is the same reminder with a wording variation (for example "headache
  medicine" and "headache medicine daily"), return the matching id in
  existing_reminder_id and set action to "none"; do not create another reminder.
- Only update an existing reminder when the user explicitly asks to change it.
- Do not infer a new reminder from an existing reminder or from a prior session.

### How to calculate event_datetime:

**If user gives exact date and time:**
Use it directly.

**If user gives time but no date (e.g. "every day at 5pm", "my medication at 8am"):**
Use today's date if the time has not passed yet. Use tomorrow if it has already passed today.

**If user gives a weekday pattern (e.g. "every Monday and Wednesday at 3:45pm"):**
- Create ONE reminder per day mentioned
- Calculate the NEXT upcoming occurrence of that weekday from current date/time
- Example: today is Saturday, appointment every Monday → event_datetime = next Monday

**If user gives a relative time (e.g. "tomorrow", "next Friday", "in two weeks"):**
Calculate the exact date from current date/time context provided above.

**If user gives only a month or vague future (e.g. "sometime in June"):**
Use the first day of that month at 09:00 local time as a best estimate.

**For recurring reminders — after calculating first occurrence:**
Set recurrence field correctly. The system will automatically calculate future occurrences from there.

### remind_from / remind_until — MANDATORY calculation:
- medication  → remind_from: event_datetime MINUS 60 minutes, remind_until: event_datetime PLUS 720 minutes
- appointment → remind_from: event_datetime MINUS 24 hours, remind_until: end of event day (23:59:59)
- birthday    → remind_from: event_datetime MINUS 48 hours, remind_until: end of event day (23:59:59)
- general     → remind_from: event_datetime MINUS 24 hours, remind_until: end of event day

### Recurrence rules:
- medication  → "daily" by default unless user says otherwise
- appointment → "weekly" if user says specific weekdays, "none" for one-time
- birthday    → "yearly" always
- general     → "none" unless user says it repeats

### recurrence values: "none" | "daily" | "weekly" | "yearly"

### Weekday calculation rules — CRITICAL:
Current date is ${now.toLocaleDateString("en-US", { timeZone: safeTimezone, weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

To find NEXT occurrence of a weekday:
- If today is Thursday and appointment is Monday → next Monday is 4 days away (Thu→Fri→Sat→Sun→Mon)
- If today is Thursday and appointment is Wednesday → next Wednesday is 6 days away
- NEVER use tomorrow or day after as next weekday if that day is not the correct weekday
- Always verify: count forward from today until you reach the correct day name

Double-check your calculation before outputting event_datetime.

### Output format — ALL fields required for medication and appointment:
- "title": short clear title, include weekday for weekly recurring (e.g. "Hockey Match Monday")
- "existing_reminder_id": matching active reminder id, or null for a truly new reminder
- "action": "create" for a new reminder, "update" only for an explicit change, or "none" for an already-existing reminder
- "description": extra context or null
- "reminder_type": "medication" | "appointment" | "birthday" | "general"
- "event_datetime": ISO8601 — REQUIRED for medication/appointment, null only if truly impossible
- "remind_from": ISO8601 — REQUIRED whenever event_datetime is set
- "remind_until": ISO8601 — REQUIRED whenever event_datetime is set
- "recurrence": "none" | "daily" | "weekly" | "yearly"

If no reminders found, return empty array [].

---

## FINAL OUTPUT FORMAT
Return ONLY this JSON. No explanation, no markdown:

{
  "facts": [...],
  "reminders": [...],
  "session_summary": "2-4 sentence summary of what was discussed in this conversation. Focus on topics covered, decisions made, emotional tone, and anything the user would want to continue next session. Write in past tense. Do not repeat facts or reminders — only summarize the conversation flow."
}

---

### EXISTING MEMORY:
"""${JSON.stringify(existingFacts?.summary || [])}"""

### ACTIVE REMINDERS:
"""${JSON.stringify(activeReminders)}"""

### NEW USER MESSAGES:
"""${userConversationText}"""
`;

    // 4️⃣ Single GPT call
    const {
      content: raw,
      inputTokens,
      outputTokens,
    } = await getGPTResponse([{ role: "user", content: prompt }], chatModel);

    // Track chat token usage for this extraction call
    if (sessionId) {
      addChatTokens(sessionId, inputTokens, outputTokens);
    }

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
    const sessionSummary =
      typeof parsed.session_summary === "string"
        ? parsed.session_summary.trim()
        : null; // 👈 new

    // 5️⃣ Save facts
    if (facts.length > 0) {
      await updateMemorySummary(token, facts);
      console.log(`✅ ${facts.length} facts stored`);
    } else {
      console.log("ℹ️ No new facts to store");
    }

    if (sessionSummary) {
      await prisma.conversationSummary.create({
        data: { userToken: token, summary: sessionSummary },
      });

      // Keep only last 2 — delete older ones
      const allSummaries = await prisma.conversationSummary.findMany({
        where: { userToken: token },
        orderBy: { sessionAt: "desc" },
      });

      if (allSummaries.length > 2) {
        const toDelete = allSummaries.slice(2).map((s) => s.id);
        await prisma.conversationSummary.deleteMany({
          where: { id: { in: toDelete } },
        });
      }

      console.log(`✅ Session summary saved`);
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
  } catch (err) {
    console.log("Error in FlushConversationToMemory: ", err.message);
  } finally {
    releaseFlushLock();
  }
}
