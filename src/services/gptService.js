import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/env.js";

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export async function getGPTResponse(messages) {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini", // fast + cheap, great for summarization
      messages,
      temperature: 0.3, // keep responses consistent
    });

    // Extract text output
    const content = completion.choices[0]?.message?.content;
    const usage = completion.usage || null;
    console.log("Chat Completion APi Usage: ", usage);

    return {
      content: content ? content.trim() : null,
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
    };
  } catch (err) {
    console.log(err.message);
    return { content: null, inputTokens: 0, outputTokens: 0 };
  }
}
