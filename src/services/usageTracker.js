// services/usageTracker.js
// In-memory accumulator for tracking API usage during a session.
// All data lives here during the session and is flushed to DB on disconnect.

const sessionUsage = new Map(); // sessionId → usage object

export function initSessionUsage(sessionId) {
  sessionUsage.set(sessionId, {
    // Realtime GPT (gpt-4o-realtime-preview)
    realtimeTextInputTokens: 0,
    realtimeAudioInputTokens: 0,
    realtimeCachedInputTokens: 0,
    realtimeCachedAudioInputTokens: 0,
    realtimeOutputTokens: 0,

    // Whisper transcription — tracked in seconds, converted to minutes for billing
    whisperSeconds: 0,

    // Chat completion GPT (gpt-4o-mini) — greeting + facts/reminders
    chatInputTokens: 0,
    chatOutputTokens: 0,

    // ElevenLabs audio characters
    realtimeAudioChars: 0, // from realtime TTS during conversation
    greetingAudioChars: 0, // from greeting audio generation
  });
}

export function addRealtimeTokens(
  sessionId,
  inputTokenDetails = {},
  outputTokens = 0,
) {
  const usage = sessionUsage.get(sessionId);
  if (!usage) return;

  const textTokens = inputTokenDetails.text_tokens || 0;
  const audioTokens = inputTokenDetails.audio_tokens || 0;
  const cachedTextTokens =
    inputTokenDetails.cached_tokens_details?.text_tokens || 0;
  const cachedAudioTokens =
    inputTokenDetails.cached_tokens_details?.audio_tokens || 0;

  // Non-cached = total minus cached portion
  usage.realtimeTextInputTokens += Math.max(0, textTokens - cachedTextTokens);
  usage.realtimeAudioInputTokens += Math.max(
    0,
    audioTokens - cachedAudioTokens,
  );
  usage.realtimeCachedInputTokens += cachedTextTokens;
  usage.realtimeCachedAudioInputTokens += cachedAudioTokens;
  usage.realtimeOutputTokens += outputTokens;
}

export function addWhisperSeconds(sessionId, seconds = 0) {
  const usage = sessionUsage.get(sessionId);
  if (!usage) return;
  usage.whisperSeconds += seconds;
}

export function addChatTokens(sessionId, inputTokens = 0, outputTokens = 0) {
  const usage = sessionUsage.get(sessionId);
  if (!usage) return;
  usage.chatInputTokens += inputTokens;
  usage.chatOutputTokens += outputTokens;
}

export function addRealtimeAudioChars(sessionId, chars = 0) {
  const usage = sessionUsage.get(sessionId);
  if (!usage) return;
  usage.realtimeAudioChars += chars;
}

export function addGreetingAudioChars(sessionId, chars = 0) {
  const usage = sessionUsage.get(sessionId);
  if (!usage) return;
  usage.greetingAudioChars += chars;
}

export function getSessionUsage(sessionId) {
  return sessionUsage.get(sessionId) || null;
}

export function clearSessionUsage(sessionId) {
  sessionUsage.delete(sessionId);
}
