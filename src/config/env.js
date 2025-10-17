import dotenv from "dotenv";
dotenv.config();

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
export const ELEVENLABS_BASE_URL = process.env.ELEVENLABS_BASE_URL;
export const PORT = process.env.PORT || 3000;
export const OPENAI_REALTIME_API = process.env.OPENAI_REALTIME_API;
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL;
