import { ELEVENLABS_VOICE_ID } from "../config/env.js";
import PersonalityConfig from "../models/PersonalityConfig.js";
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
  if (!token) {
    throw new Error("Token is required to fetch voice config");
  }

  const personality = await PersonalityConfig.findOne({
    userToken: token,
    isActive: true,
  }).lean();

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
}
