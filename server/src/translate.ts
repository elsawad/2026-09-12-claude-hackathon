import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = "claude-sonnet-5";

export interface TranslationResult {
  language: string; // human-readable, e.g. "Arabic", "English", "French"
  isEnglishOrFrench: boolean;
  translatedToEnglish: string | null; // null when isEnglishOrFrench is true — no translation needed
}

const TOOL = {
  name: "submit_translation",
  description: "Report the detected language and, if needed, an English translation.",
  input_schema: {
    type: "object" as const,
    properties: {
      language: { type: "string" as const, description: "Human-readable language name, e.g. 'Arabic'." },
      is_english_or_french: { type: "boolean" as const },
      translated_to_english: {
        type: ["string", "null"] as any,
        description: "English translation, preserving meaning plainly. Null if the text is already English or French."
      }
    },
    required: ["language", "is_english_or_french", "translated_to_english"]
  }
};

/**
 * Per PRD 6.4: English and French are first class (no translation needed,
 * no caveat). Anything else gets translated for the officer view, with the
 * original always kept alongside, and an AI-translation notice shown on
 * both sides.
 */
export async function detectAndTranslate(text: string): Promise<TranslationResult | null> {
  if (!text.trim()) return null;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "Detect the language of the user's text. If it is English or French, do not translate it. " +
      "Otherwise translate it into plain English, preserving the original meaning without embellishment. " +
      "Respond only by calling submit_translation.",
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_translation" },
    messages: [{ role: "user", content: text }]
  });

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) return null;

  const raw = toolUse.input as {
    language: string;
    is_english_or_french: boolean;
    translated_to_english: string | null;
  };
  return {
    language: raw.language,
    isEnglishOrFrench: raw.is_english_or_french,
    translatedToEnglish: raw.is_english_or_french ? null : raw.translated_to_english
  };
}

/** Respond to the resident (e.g. the private-property diversion message) in their own language. */
export async function respondInLanguage(englishText: string, targetLanguage: string): Promise<string> {
  if (targetLanguage.toLowerCase() === "english") return englishText;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `Translate the following message into ${targetLanguage}, plainly and accurately. Respond with only the translation, nothing else.`,
    messages: [{ role: "user", content: englishText }]
  });

  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return textBlock?.text ?? englishText;
}
