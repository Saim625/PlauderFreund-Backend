import dotenv from "dotenv";
dotenv.config();

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
export const ELEVENLABS_BASE_URL = process.env.ELEVENLABS_BASE_URL;
export const PORT = process.env.PORT || 3000;
export const OPENAI_REALTIME_API = process.env.OPENAI_REALTIME_API;
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL;
export const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
export const EMAIL_PASS = process.env.EMAIL_PASS;
export const FRONTEND_URL = process.env.FRONTEND_URL;
export const USER_NAME = process.env.USER_NAME;
export const ARI_HOST = process.env.ARI_HOST || "127.0.0.1";
export const ARI_PORT = Number(process.env.ARI_PORT || 8088);
export const ARI_USERNAME = process.env.ARI_USERNAME;
export const ARI_PASSWORD = process.env.ARI_PASSWORD;

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const WEBRTC_ENABLED = (process.env.WEBRTC_ENABLED || "true") === "true";
export const WEBRTC_TTS_ENABLED =
  (process.env.WEBRTC_TTS_ENABLED ?? "true") === "true";
export const WEBRTC_SIGNALING_ROLE =
  process.env.WEBRTC_SIGNALING_ROLE || "caller";
export const WEBRTC_ICE_SERVERS = parseJsonEnv(process.env.WEBRTC_ICE_SERVERS, [
  { urls: "stun:stun.l.google.com:19302" },
]);
