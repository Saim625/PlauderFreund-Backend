// services/costCalculator.js

import prisma from "../lib/db.js";

/**
 * Calculates session cost in USD based on usage + DB pricing
 * NOTE: No rounding here — keep raw precision for billing accuracy
 */
export async function calculateSessionCost(usage = {}) {
  try {
    // 1. Fetch pricing from DB
    const pricingRows = await prisma.providerPricing.findMany();

    // 2. Build a fast lookup map: "provider_priceType" -> rate per unit
    const pricingMap = new Map();

    for (const row of pricingRows) {
      if (!row.unitSize || row.unitSize === 0) {
        throw new Error(
          `Invalid unitSize for ${row.provider}:${row.priceType}`,
        );
      }

      const key = `${row.provider}_${row.priceType}`;
      const ratePerUnit = row.pricePerUnit / row.unitSize;

      pricingMap.set(key, ratePerUnit);
    }

    // 3. Helper to safely get rate
    const getRate = (provider, priceType) => {
      const key = `${provider}_${priceType}`;
      const rate = pricingMap.get(key);

      if (rate === undefined) {
        throw new Error(`Missing pricing for ${provider}:${priceType}`);
      }

      return rate;
    };

    // 4. Normalize usage (prevent undefined issues)
    const safeUsage = {
      realtimeTextInputTokens: usage.realtimeTextInputTokens || 0,
      realtimeAudioInputTokens: usage.realtimeAudioInputTokens || 0,
      realtimeCachedInputTokens: usage.realtimeCachedInputTokens || 0,
      realtimeCachedAudioInputTokens: usage.realtimeCachedAudioInputTokens || 0,
      realtimeOutputTokens: usage.realtimeOutputTokens || 0,
      whisperSeconds: usage.whisperSeconds || 0,
      chatInputTokens: usage.chatInputTokens || 0,
      chatOutputTokens: usage.chatOutputTokens || 0,
      realtimeAudioChars: usage.realtimeAudioChars || 0,
      greetingAudioChars: usage.greetingAudioChars || 0,
    };

    // 5. Realtime GPT cost (e.g., gpt-4o-realtime)
    const realtimeGptCost =
      safeUsage.realtimeTextInputTokens *
        getRate("openai_realtime", "text_input_token") +
      safeUsage.realtimeAudioInputTokens *
        getRate("openai_realtime", "audio_input_token") +
      safeUsage.realtimeCachedInputTokens *
        getRate("openai_realtime", "cached_text_input_token") +
      safeUsage.realtimeCachedAudioInputTokens *
        getRate("openai_realtime", "cached_audio_input_token") +
      safeUsage.realtimeOutputTokens *
        getRate("openai_realtime", "output_token");

    // 6. Chat GPT cost (e.g., gpt-4o-mini)
    const chatGptCost =
      safeUsage.chatInputTokens * getRate("openai_chat", "input_token") +
      safeUsage.chatOutputTokens * getRate("openai_chat", "output_token");

    const whisperCost =
      (safeUsage.whisperSeconds / 60) * getRate("whisper", "per_minute");

    // 7. ElevenLabs cost (audio characters)
    const elevenlabsCost =
      (safeUsage.realtimeAudioChars + safeUsage.greetingAudioChars) *
      getRate("elevenlabs", "audio_character");

    // 8. Total cost
    const totalCost = realtimeGptCost + chatGptCost + elevenlabsCost;

    // 9. Return structured breakdown
    return {
      success: true,
      data: {
        realtimeGptCost,
        chatGptCost,
        whisperCost,
        elevenlabsCost,
        totalCost,
      },
    };
  } catch (error) {
    console.error("❌ Cost calculation failed:", error.message);

    return {
      success: false,
      error: error.message,
      data: {
        realtimeGptCost: 0,
        chatGptCost: 0,
        whisperCost: 0,
        elevenlabsCost: 0,
        totalCost: 0,
      },
    };
  }
}
