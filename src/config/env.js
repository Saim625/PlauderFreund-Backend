import dotenv from "dotenv";
dotenv.config();

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
export const PORT = process.env.PORT || 3000;
