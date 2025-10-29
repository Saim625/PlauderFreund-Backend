import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/env.js";

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export async function getGPTResponse(messages) {
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini", // fast + cheap, great for summarization
    messages,
    temperature: 0.3, // keep responses consistent
  });

  // Extract text output
  return completion.choices[0].message.content.trim();
}
