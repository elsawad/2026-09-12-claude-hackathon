import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "./types.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = "claude-sonnet-5";

export interface ScoringInput {
  description: string | null;
  descriptionLanguage: string | null;
  questionnaireLocationAnswer: string | null;
  questionnaireDangerAnswer: string | null;
  landStatus: string;
  utilityProximityM: number | null;
  utilityFeatureType: string | null;
  windContext: string | null;
  eabFlag: boolean;
  historicalPatternNote: string | null;
  preFlaggedUrgent: boolean;
  photoBase64: string | null;
  photoMediaType: string | null;
}

export interface ScoringOutput {
  category: Category;
  priority: Priority;
  reason: string;
  confidence: number;
  missing_detail: string | null;
  photo_shows_tree_hazard: boolean;
}

const SYSTEM_PROMPT = `You are the triage assistant for Canopy Watch, a Halifax Regional \
Municipality (HRM) tree-hazard reporting tool. You are proposing a category and priority for a \
human arborist to review — you never make the final call, you only save them the 2-3 days it \
currently takes for a request to reach a human at all.

HRM's real Urban Forestry service standards distinguish two priorities: Priority 1 is an \
immediate threat to the public, to property, or to park assets (e.g. a hanging limb over a \
sidewalk, a tree leaning on a structure, a branch blocking a road) — assessed within 3 business \
days and repaired within 1 business day. Priority 2 is routine (a tree that looks unhealthy but \
poses no immediate threat, routine pruning, stump removal) — addressed within 12 to 36 months \
depending on scope. You express your judgement through two fields instead of guessing a tier \
directly:

- "category": the best-fitting single label for what's actually wrong — "utility" (touching or \
near power/utility infrastructure), "fallen" (already down), "hanging_limb" (a limb or branch \
that has failed and is hanging), "pruning" (needs a trim, not a failure), "stump" (stump \
removal), "disease" (looks unhealthy/dying but nothing has failed), "blockage" (blocking a road, \
sidewalk, or driveway without a clean fit above), or "other" only when nothing above fits or you \
genuinely can't tell.
- "priority": "high" (matches HRM's Priority 1 — immediate threat to a person, structure, \
vehicle, or right-of-way, right now), "medium" (a real issue but not an immediate threat), or \
"low" (routine, no urgency).

If you cannot responsibly choose between these with what's given, do not guess to look decisive: \
set category to "other" and priority to "low", and use "missing_detail" to say exactly what \
additional detail would resolve it (this is how the system flags a report as needing more \
information rather than acting on a wrong confident guess). Do not use this combination for any \
other reason — it exists specifically for "I don't have enough to go on."

Anything near documented utility infrastructure (a transmission line, substation, tower, \
pipeline, or tank) is "utility" category — this takes priority over every other signal, because \
a tree near power infrastructure is not just an HRM tree matter.

You are also the spam/content filter: if a photo is attached, judge whether it plausibly shows a \
tree, branch, or related vegetation hazard at all (set photo_shows_tree_hazard accordingly). A \
report with a photo that clearly shows something unrelated (a person, a receipt, a blank image, \
an unrelated object) should get category "other", priority "low", and missing_detail asking for \
a clear photo of the tree, regardless of what the description claims.

Weigh wind context as supporting evidence only (higher wind can make an already-marginal hazard \
more urgent) — never let wind alone push a report to "high" priority or "utility" category.

Respond only by calling the submit_triage tool. Never fabricate certainty you don't have.`;

const TOOL = {
  name: "submit_triage",
  description: "Submit the triage result for this tree hazard report.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: { type: "string" as const, enum: CATEGORIES as unknown as string[] },
      priority: { type: "string" as const, enum: PRIORITIES as unknown as string[] },
      reason: {
        type: "string" as const,
        description: "One plain-language sentence an officer can read in under 3 seconds."
      },
      confidence: { type: "number" as const, minimum: 0, maximum: 1 },
      missing_detail: {
        type: ["string", "null"] as any,
        description: "Required (non-null) when category is 'other' and priority is 'low'; otherwise null."
      },
      photo_shows_tree_hazard: { type: "boolean" as const }
    },
    required: ["category", "priority", "reason", "confidence", "missing_detail", "photo_shows_tree_hazard"]
  }
};

function buildContextBlock(input: ScoringInput): string {
  const lines = [
    `Description (may be non-English, translated already if so): ${input.description ?? "(none provided)"}`,
    `Description language: ${input.descriptionLanguage ?? "unknown"}`,
    `Questionnaire — where is the tree: ${input.questionnaireLocationAnswer ?? "not answered"}`,
    `Questionnaire — is it dangerous right now: ${input.questionnaireDangerAnswer ?? "not answered"}`,
    `Land status (geometry/questionnaire proxy, NOT authoritative ownership): ${input.landStatus}`,
    `Utility proximity: ${
      input.utilityProximityM !== null
        ? `${Math.round(input.utilityProximityM)}m from nearest ${input.utilityFeatureType}`
        : "no utility infrastructure found nearby"
    }`,
    `Current wind: ${input.windContext ?? "unavailable"}`,
    `Emerald ash borer (EAB) regulated area: ${input.eabFlag ? "yes" : "no"}`,
    `Historical pattern at this location: ${input.historicalPatternNote ?? "no prior reports/work orders found nearby"}`,
    `Resident pre-flagged this as urgent (blocking a road/sidewalk, or already fallen): ${input.preFlaggedUrgent}`
  ];
  return lines.join("\n");
}

export async function scoreReport(input: ScoringInput): Promise<ScoringOutput> {
  const content: Anthropic.MessageParam["content"] = [{ type: "text", text: buildContextBlock(input) }];

  if (input.photoBase64 && input.photoMediaType) {
    content.unshift({
      type: "image",
      source: { type: "base64", media_type: input.photoMediaType as any, data: input.photoBase64 }
    });
  }

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_triage" },
    messages: [{ role: "user", content }]
  });

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a submit_triage tool call");

  const result = toolUse.input as ScoringOutput;
  if (!CATEGORIES.includes(result.category)) {
    throw new Error(`Claude returned an invalid category: ${result.category}`);
  }
  if (!PRIORITIES.includes(result.priority)) {
    throw new Error(`Claude returned an invalid priority: ${result.priority}`);
  }
  return result;
}
