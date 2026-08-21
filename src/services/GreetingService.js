import express from "express";
import {
  addChatTokens,
  addGreetingAudioChars,
} from "../services/usageTracker.js";
import prisma from "../lib/db.js";
import { getGPTResponse } from "./gptService.js";
import { generateGreetingAudio } from "./generateGreetingAudio.js";
import { greetingStore } from "../state/greetingStore.js";
import { getVoiceConfigForToken } from "../utils/getVoiceConfigForToken.js";
import { sessionRegistry } from "./sessionRegistry.js";

const MAX_GREETING_HISTORY = 3;

export async function generateGreeting(
  token,
  { outputFormat = "pcm_24000" } = {},
) {
  try {
    // ✅ Validate token exists before doing anything
    const userExists = await prisma.userAccessToken.findUnique({
      where: { token },
    });

    if (!userExists) {
      console.warn(`⚠️ Invalid token attempted: ${token}`);
    }

    const memory = await prisma.memorySummary.findUnique({
      where: { token },
      include: { summary: true },
    });
    const rawSummary = Array.isArray(memory?.summary) ? memory.summary : [];

    const biographyText = rawSummary.length
      ? rawSummary.map((i) => `${i.key}: ${i.value}`).join(", ")
      : "No biography yet";

    // ✅ Fetch last 3 greetings to avoid repetition
    const previousGreetings = await prisma.greetingHistory.findMany({
      where: { userToken: token },
      orderBy: { createdAt: "desc" },
      take: MAX_GREETING_HISTORY,
    });

    const previousGreetingsText = previousGreetings.length
      ? previousGreetings.map((g, i) => `${i + 1}. "${g.text}"`).join("\n")
      : "None yet";

    const voiceConfig = await getVoiceConfigForToken(token);

    const personalityConfig = await prisma.personalityConfig.findUnique({
      where: { userToken: token },
    });
    const chatModel = personalityConfig?.chatModel || "gpt-4o-mini";

    const prompt = [
      {
        role: "system",
        content: `You are a warm, friendly AI assistant speaking to the user, talk in german or user prefered language if present in user-biography.
        Generate a single short greeting sentence — maximum 15 words.
        Every greeting must feel genuinely different in structure and opening — not just different words for the same idea.

        Vary the opening style each time. Examples of different styles, these styles are just for example:
        - Ask something personal: "Wie war dein gestrige Spaziergang, [Name]?"
        - Make an observation: "Schön, dass du wieder da bist!"
        - Reference something from their life: "Hast du heute schon deine Medizin genommen?"
        - Be playful: "Na, wer kommt denn da wieder vorbei?"
        - Be warm and simple: "Hallo [Name], ich hab auf dich gewartet."

        Use the user's biography to pick the most relevant style for today.
        STRICT RULE: Do NOT use the same opening word or sentence structure as any previous greeting listed below.

Previous greetings (forbidden to resemble):
${previousGreetingsText}`,
      },
      {
        role: "user",
        content: `User Biography:\n${biographyText}\n\nGenerate one greeting now. Maximum 15 words. Must feel completely different from the previous ones.`,
      },
    ];

    const {
      content: greetingText,
      inputTokens,
      outputTokens,
    } = await getGPTResponse(prompt, chatModel);

    greetingStore.set(token, greetingText);

    const sessionId = sessionRegistry.getSessionId(token);

    console.log("SessionId", sessionId);

    if (sessionId) {
      addChatTokens(sessionId, inputTokens, outputTokens);
    }

    try {
      await prisma.greetingHistory.create({
        data: { userToken: token, text: greetingText },
      });

      const allGreetings = await prisma.greetingHistory.findMany({
        where: { userToken: token },
        orderBy: { createdAt: "desc" },
      });

      if (allGreetings.length > MAX_GREETING_HISTORY) {
        const toDelete = allGreetings.slice(MAX_GREETING_HISTORY);
        await prisma.greetingHistory.deleteMany({
          where: { id: { in: toDelete.map((g) => g.id) } },
        });
      }
    } catch (historyErr) {
      console.error(
        "⚠️ Failed to save greeting history (non-fatal):",
        historyErr.message,
      );
    }

    const audioBuffer = await generateGreetingAudio(greetingText, voiceConfig, {
      outputFormat,
    });

    // Track greeting audio characters
    if (sessionId) {
      addGreetingAudioChars(sessionId, greetingText.length);
      console.log("Greeting Audio Chatrs Insterted");
    }

    return {
      text: greetingText,
      audioBuffer,
      outputFormat,
    };
  } catch (err) {
    console.error("Error generating greeting:", err);
  }
}
