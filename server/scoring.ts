import Anthropic from "@anthropic-ai/sdk";
import type { ScoringInput, ScoringOutput, Tier } from "./types.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = "claude-sonnet-5";

const VALID_TIERS: Tier[] = ["utility_emergency", "imminent_hazard", "routine", "insufficient_info"];

const SYSTEM_PROMPT = `You are the triage assistant for Canopy Watch, a Halifax Regional \
Municipality (HRM) tree-hazard reporting tool. You are proposing a tier for a human arborist \
to review — you never make the final call, you only save them the 2-3 days it currently takes \
for a request to reach a human at all.

HRM's real Urban Forestry service standards distinguish two priorities: Priority 1 is an \
immediate threat to the public, to property, or to park assets (e.g. a hanging limb over a \
sidewalk, a tree leaning on a structure, a branch blocking a road) — assessed within 3 \
business days and repaired within 1 business day. Priority 2 is routine (a tree that looks \
unhealthy but poses no immediate threat, routine pruning, stump removal) — addressed within \
12 to 36 months depending on the scope of work. Canopy Watch's tiers map onto this:

- "utility_emergency": the report is within a documented buffer distance of NS Topographic \
Utilities infrastructure (a transmission line, substation, tower, pipeline, or tank). This \
takes priority over every other signal — a tree near power infrastructure is not just an \
HRM tree matter.
- "imminent_hazard": HRM's Priority 1 standard — immediate threat to a person, structure, \
vehicle, or right-of-way, right now.
- "routine": HRM's Priority 2 standard — no immediate threat.
- "insufficient_info": you cannot responsibly choose between imminent_hazard and routine with \
what's given. Say exactly what additional detail would resolve it. Do not guess to avoid this \
tier — a wrong confident guess is worse than an honest "not enough information".

You are also the spam/content filter: if a photo is attached, judge whether it plausibly shows \
a tree, branch, or related vegetation hazard at all (set photo_shows_tree_hazard accordingly). \
A report with a photo that clearly shows something unrelated (a person, a receipt, a blank \
image, an unrelated object) should be scored "insufficient_info" with missing_detail asking for \
a clear photo of the tree, regardless of what the description claims.

Weigh wind context as supporting evidence only (higher wind can make an already-marginal hazard \
more urgent) — never let wind alone push a report into utility_emergency or imminent_hazard.

Respond only by calling the submit_triage tool. Never fabricate certainty you don't have.`;

const TOOL = {
  name: "submit_triage",
  description: "Submit the triage result for this tree hazard report.",
  input_schema: {
    type: "object" as const,
    properties: {
      proposed_tier: { type: "string" as const, enum: VALID_TIERS },
      reason: {
        type: "string" as const,
        description: "One plain-language sentence an officer can read in under 3 seconds."
      },
      confidence: { type: "number" as const, minimum: 0, maximum: 1 },
      missing_detail: {
        type: ["string", "null"] as any,
        description: "Required (non-null) when proposed_tier is insufficient_info; otherwise null."
      },
      photo_shows_tree_hazard: { type: "boolean" as const }
    },
    required: ["proposed_tier", "reason", "confidence", "missing_detail", "photo_shows_tree_hazard"]
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
  if (!VALID_TIERS.includes(result.proposed_tier)) {
    throw new Error(`Claude returned an invalid tier: ${result.proposed_tier}`);
  }
  return result;
}
