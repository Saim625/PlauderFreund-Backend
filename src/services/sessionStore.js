// Simple in-memory map: token → socket
// Used by reminder scheduler to deliver reminders to active sessions

const activeSessions = new Map();

export function setSession(token, socket) {
  activeSessions.set(token, socket);
}

export function getSession(token) {
  return activeSessions.get(token) || null;
}

export function deleteSession(token) {
  activeSessions.delete(token);
}

export function getAllSessions() {
  return activeSessions;
}
