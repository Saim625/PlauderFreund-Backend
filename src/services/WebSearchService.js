import OpenAI from "openai";
import logger from "../utils/logger.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class WebSearchService {
  static async search(query) {
    logger.info(`🔎 Web Search: "${query}"`);

    const start = Date.now();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",

      tools: [
        {
          type: "web_search_preview",
        },
      ],

      input: query,
    });

    logger.info(`✅ Web Search completed in ${Date.now() - start} ms`);

    const answer =
      response.output_text || "I couldn't find any useful information.";

    return {
      answer,
      usage: response.usage,
      responseId: response.id,
    };
  }
}
