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
    realtimeOutputTokens: 0,

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
  inputTokens = 0,
  outputTokens = 0,
) {
  const usage = sessionUsage.get(sessionId);
  if (!usage) return;
  usage.realtimeTextInputTokens += inputTokens.text_tokens || 0;
  usage.realtimeAudioInputTokens += inputTokens.audio_tokens || 0;
  usage.realtimeCachedInputTokens += inputTokens.cached_tokens || 0;
  usage.realtimeOutputTokens += outputTokens;
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
