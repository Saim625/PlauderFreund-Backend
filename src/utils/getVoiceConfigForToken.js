import { ELEVENLABS_VOICE_ID } from "../config/env.js";
import prisma from "../lib/db.js";
/**
 * Returns ElevenLabs voice + behavior config for a user token
 * @param {string} token
 * @returns {{
 *   voiceId: string,
 *   empathyLevel: "low" | "medium" | "high",
 *   speakingSpeed: "slow" | "normal" | "fast"
 * }}
 */
export async function getVoiceConfigForToken(token) {
  try {
    if (!token) {
      throw new Error("Token is required to fetch voice config");
    }

    const personality = await prisma.personalityConfig.findFirst({
      where: {
        userToken: token,
        isActive: true,
      },
    });

    // 🔁 Fallback if no config exists (old tokens / safety)
    if (!personality) {
      return {
        voiceId: ELEVENLABS_VOICE_ID,
        empathyLevel: "medium",
        speakingSpeed: "normal",
      };
    }

    return {
      voiceId: personality.voiceId || ELEVENLABS_VOICE_ID,

      empathyLevel: personality.empathyLevel || "medium",

      speakingSpeed: personality.speakingSpeed || "normal",
    };
  } catch (err) {
    console.log("getVoiceConfigForToken", err);
  }
}
