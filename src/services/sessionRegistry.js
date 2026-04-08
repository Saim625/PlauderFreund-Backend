// services/sessionRegistry.js
// Maps userToken → sessionId (socket.id) so other services like
// greeting and gptService can find the active session and track usage against it.
// This is needed because greeting route runs outside of realtimeHandler scope.

const tokenToSession = new Map();

export const sessionRegistry = {
  register(token, sessionId) {
    tokenToSession.set(token, sessionId);
  },

  getSessionId(token) {
    return tokenToSession.get(token) || null;
  },

  unregister(token) {
    tokenToSession.delete(token);
  },
};
