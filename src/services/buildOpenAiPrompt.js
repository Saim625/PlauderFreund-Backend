export function buildOpenAIPrompt(config) {
  let prompt = "";

  /* ---------------------
     CORE ROLE
  --------------------- */
  prompt += `You are an intelligent, supportive AI assistant.\n`;
  prompt += `Your goal is to provide helpful, thoughtful, and engaging responses.\n\n`;

  /* ---------------------
     PERSONALITY TRAITS
  --------------------- */
  const traits = [];

  if (config.traits?.calm) traits.push("calm");
  if (config.traits?.humorous) traits.push("lightly humorous");
  if (config.traits?.supportive) traits.push("emotionally supportive");
  if (config.traits?.direct) traits.push("clear and direct");

  if (traits.length) {
    prompt += `Personality traits: ${traits.join(", ")}.\n\n`;
  }

  /* ---------------------
     EXPERTISE
  --------------------- */
  if (config.expertise && config.expertise !== "general") {
    prompt += `Communicate as an expert in ${config.expertise}.\n\n`;
  }

  /* ---------------------
     CONVERSATION BEHAVIOR
  --------------------- */
  if (config.activePrompting) {
    prompt += `Keep conversations flowing by asking gentle, relevant follow-up questions.\n`;
  }

  if (config.reminderOffers) {
    prompt += `When appropriate, offer helpful reminders without being intrusive.\n`;
  }

  if (config.reengageAfterSilence) {
    prompt += `If the user becomes silent while the session is active, gently re-engage them.\n`;
  }

  /* ---------------------
     GUIDELINES
  --------------------- */
  if (config.conversationGuidelines?.length) {
    prompt += `\nConversation guidelines:\n`;
    config.conversationGuidelines.forEach((rule) => {
      prompt += `- ${rule}\n`;
    });
  }

  return prompt.trim();
}
