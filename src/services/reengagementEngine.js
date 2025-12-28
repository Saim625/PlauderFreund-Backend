export const sessions = new Map();

export function initSession(socketId) {
  sessions.set(socketId, {
    lastUserAudioAt: Date.now(),
    lastAiPlaybackFinishedAt: Date.now(),
    aiIsSpeaking: false,
    cooldownUntil: 0,
    conversationActive: false, // 🔥 NEW
  });
}

export function destroySession(socketId) {
  sessions.delete(socketId);
}

export function markUserAudio(socketId) {
  const s = sessions.get(socketId);
  if (s) s.lastUserAudioAt = Date.now();
}

export function markAiSpeaking(socketId) {
  const s = sessions.get(socketId);
  if (s) s.aiIsSpeaking = true;
}

export function markAiPlaybackDone(socketId) {
  const s = sessions.get(socketId);
  if (s) {
    s.aiIsSpeaking = false;
    s.lastAiPlaybackFinishedAt = Date.now();
  }
}

export function markReengagementTriggered(socketId) {
  const s = sessions.get(socketId);
  if (s) {
    s.cooldownUntil = Date.now() + 20000; // only AFTER FE confirms
  }
}

export function startReengagementLoop(triggerFn) {
  setInterval(() => {
    const now = Date.now();

    for (const [socketId, s] of sessions.entries()) {
      const lastActivity = Math.max(
        s.lastUserAudioAt,
        s.lastAiPlaybackFinishedAt
      );

      const silentFor = now - lastActivity;

      // 🧱 block reasons
      if (!s.conversationActive) {
        continue;
      }

      if (s.aiIsSpeaking) {
        continue;
      }

      if (now < s.cooldownUntil) {
        continue;
      }

      if (silentFor < 10000) {
        continue;
      }

      // 🔥 This is the moment that MUST happen
      triggerFn(socketId);
    }
  }, 4000);
}
