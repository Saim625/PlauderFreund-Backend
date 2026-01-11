import logger from "../utils/logger.js";

export const sessions = new Map();

export function initSession(socketId) {
  sessions.set(socketId, {
    lastUserAudioAt: Date.now(),
    lastAiPlaybackFinishedAt: Date.now(),
    aiIsSpeaking: false,
    userIsSpeaking: false,
    cooldownUntil: 0,
    conversationActive: false,
  });
  logger.info(`🎬 [${socketId}] Session initialized`);
}

export function destroySession(socketId) {
  sessions.delete(socketId);
  logger.info(`🗑️ [${socketId}] Session destroyed`);
}

export function markUserAudio(socketId) {
  const s = sessions.get(socketId);
  if (s) {
    const now = Date.now();
    s.lastUserAudioAt = now;

    // 🔥 Also reset cooldown when user speaks (prevents premature re-engagement)
    s.cooldownUntil = 0;

    logger.info(
      `🎤 [${socketId}] User audio detected at ${new Date(now).toISOString()}`
    );
  }
}

export function markUserSpeaking(socketId, isSpeaking) {
  const s = sessions.get(socketId);
  if (s) {
    s.userIsSpeaking = isSpeaking;
    s.lastUserAudioAt = Date.now();
    s.cooldownUntil = 0;

    const status = isSpeaking ? "started" : "stopped";
    logger.info(
      `🎤 [${socketId}] User ${status} speaking at ${new Date().toISOString()}`
    );
  }
}

export function markAiSpeaking(socketId) {
  const s = sessions.get(socketId);
  if (s) {
    // Only log when state changes
    if (!s.aiIsSpeaking) {
      s.aiIsSpeaking = true;
      logger.info(
        `🤖 [${socketId}] AI started speaking at ${new Date().toISOString()}`
      );
    }
  }
}

export function markAiPlaybackDone(socketId) {
  const s = sessions.get(socketId);
  if (s) {
    const now = Date.now();
    s.aiIsSpeaking = false;
    s.lastAiPlaybackFinishedAt = now;

    logger.info(
      `✅ [${socketId}] AI playback finished at ${new Date(now).toISOString()}`
    );
    logger.info(
      `   → Re-engagement will trigger after 10s of silence (at ${new Date(
        now + 20000
      ).toISOString()})`
    );
  }
}

export function markReengagementTriggered(socketId) {
  const s = sessions.get(socketId);
  if (s) {
    const cooldownEnd = Date.now() + 20000;
    s.cooldownUntil = cooldownEnd;
    logger.info(
      `🔄 [${socketId}] Re-engagement triggered. Cooldown until ${new Date(
        cooldownEnd
      ).toISOString()}`
    );
  }
}

export function startReengagementLoop(triggerFn) {
  let loopCount = 0;

  setInterval(() => {
    loopCount++;
    const now = Date.now();

    // Only log every 15 iterations (1 minute) to avoid spam
    const shouldLogStatus = loopCount % 15 === 0;

    if (shouldLogStatus) {
      logger.info(
        `🔁 [REENGAGEMENT LOOP] Check #${loopCount} - Active sessions: ${sessions.size}`
      );
    }

    for (const [socketId, s] of sessions.entries()) {
      const lastActivity = Math.max(
        s.lastUserAudioAt,
        s.lastAiPlaybackFinishedAt
      );

      const silentFor = now - lastActivity;
      const silentForSeconds = Math.floor(silentFor / 1000);

      // 🧱 Check blocking reasons
      if (!s.conversationActive) {
        if (shouldLogStatus) {
          logger.info(`   [${socketId}] BLOCKED: Conversation not active`);
        }
        continue;
      }

      if (s.aiIsSpeaking) {
        if (shouldLogStatus) {
          logger.info(`   [${socketId}] BLOCKED: AI is speaking`);
        }
        continue;
      }

      // 🔥 NEW: Block if user is actively speaking
      if (s.userIsSpeaking) {
        if (shouldLogStatus) {
          logger.info(`   [${socketId}] BLOCKED: User is speaking`);
        }
        continue;
      }

      if (now < s.cooldownUntil) {
        const cooldownRemaining = Math.ceil((s.cooldownUntil - now) / 1000);
        if (shouldLogStatus) {
          logger.info(
            `   [${socketId}] BLOCKED: In cooldown (${cooldownRemaining}s remaining)`
          );
        }
        continue;
      }

      if (silentFor < 20000) {
        if (shouldLogStatus) {
          logger.info(
            `   [${socketId}] WAITING: Silent for ${silentForSeconds}s (need 10s)`
          );
        }
        continue;
      }

      // 🔥 All conditions met - trigger re-engagement!
      logger.info(
        `🚨 [${socketId}] RE-ENGAGEMENT TRIGGERED! (silent for ${silentForSeconds}s)`
      );
      logger.info(
        `   Last user audio: ${new Date(s.lastUserAudioAt).toISOString()}`
      );
      logger.info(
        `   Last AI playback: ${new Date(
          s.lastAiPlaybackFinishedAt
        ).toISOString()}`
      );

      triggerFn(socketId);
    }
  }, 4000); // Check every 4 seconds
}

// Debug function to get session state
export function getSessionState(socketId) {
  const s = sessions.get(socketId);
  if (!s) return null;

  const now = Date.now();
  return {
    conversationActive: s.conversationActive,
    aiIsSpeaking: s.aiIsSpeaking,
    userIsSpeaking: s.userIsSpeaking,
    silentForMs: now - Math.max(s.lastUserAudioAt, s.lastAiPlaybackFinishedAt),
    cooldownRemainingMs: Math.max(0, s.cooldownUntil - now),
    lastUserAudioAt: new Date(s.lastUserAudioAt).toISOString(),
    lastAiPlaybackFinishedAt: new Date(
      s.lastAiPlaybackFinishedAt
    ).toISOString(),
  };
}
