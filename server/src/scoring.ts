import Anthropic from "@anthropic-ai/sdk";
import {
  WORK_CATEGORIES,
  type ScoringInput,
  type ScoringOutput,
  type WorkCategory,
} from "./types.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are the triage assistant for Canopy Watch, a Halifax Regional \
Municipality (HRM) tree-hazard reporting tool. You are preparing a recommendation for a \
human arborist to review — you never make the final call, you only save them the 2-3 days it \
currently takes for a request to reach a human at all.

Choose exactly one HRM work category: tree assessment, chipping/brush removal, \
pruning/trimming, stump removal, tree removal, tree replacement, or tree miscellaneous. \
Classify an unclear tree condition as tree assessment rather than diagnosing damage that is \
not visible.

Separately identify whether the supplied evidence shows an immediate threat to the public, \
property, or park assets right now, such as a hanging limb over a sidewalk, a tree contacting \
a structure, or a branch blocking a road. Do not assign a priority yourself; application code \
maps your evidence to HRM's published Priority 1 and Priority 2 rules.

You are also the spam/content filter: if a photo is attached, judge whether it plausibly shows a \
tree, branch, or related vegetation hazard at all (set photo_shows_tree_hazard accordingly). A \
report with a photo that clearly shows something unrelated (a person, a receipt, a blank image, \
an unrelated object) must set photo_shows_tree_hazard and immediate_threat to false, classify \
the work as tree_assessment, and use missing_detail to ask for a clear photo of the tree, \
regardless of what the description claims.

Weigh wind context as supporting evidence only (higher wind can make an already-marginal hazard \
more urgent) — never let wind alone establish an immediate threat. Population density and \
nearby work history describe possible impact and context; neither proves that this tree is \
dangerous. Use only visible evidence and supplied facts, and do not diagnose hidden structural \
conditions.

Respond only by calling the submit_triage tool. Never fabricate certainty you don't have.`;

const TOOL = {
  name: "submit_triage",
  description: "Submit the triage result for this tree hazard report.",
  input_schema: {
    type: "object" as const,
    properties: {
      work_category: { type: "string" as const, enum: WORK_CATEGORIES as unknown as string[] },
      immediate_threat: {
        type: "boolean" as const,
        description: "True only when visible or reported evidence supports an immediate threat right now.",
      },
      visible_hazard_signals: {
        type: "array" as const,
        items: { type: "string" as const },
        maxItems: 5,
      },
      reason: {
        type: "string" as const,
        description: "One plain-language sentence an officer can read in under 3 seconds.",
      },
      confidence: { type: "number" as const, minimum: 0, maximum: 1 },
      missing_detail: {
        type: ["string", "null"] as any,
        description: "Required when the image does not show a tree hazard; otherwise null.",
      },
      photo_shows_tree_hazard: { type: "boolean" as const },
    },
    required: [
      "work_category",
      "immediate_threat",
      "visible_hazard_signals",
      "reason",
      "confidence",
      "missing_detail",
      "photo_shows_tree_hazard",
    ],
    additionalProperties: false,
  },
};

function buildContextBlock(input: ScoringInput): string {
  const currentOrders = input.nearbyRequests.filter((request) => request.is_current);
  const pastOrders = input.nearbyRequests.filter((request) => !request.is_current);
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
    `Census population impact: ${
      input.populationImpact
        ? `${input.populationImpact.population} residents, ${input.populationImpact.population_density_per_km2}/km² (${input.populationImpact.density_percentile}th density percentile)`
        : "no matching dissemination area"
    }`,
    `Cityworks tree orders within 50m: ${currentOrders.length} current, ${pastOrders.length} past`,
    `Nearest Cityworks orders: ${
      input.nearbyRequests
        .slice(0, 5)
        .map(
          (request) =>
            `${request.distance_m}m — ${request.work_category ?? "unknown work"} — ${request.status ?? "unknown status"}`,
        )
        .join("; ") || "none"
    }`,
    `Resident pre-flagged this as urgent (blocking a road/sidewalk, or already fallen): ${input.preFlaggedUrgent}`,
  ];
  return lines.join("\n");
}

function parseScoringOutput(value: unknown): ScoringOutput {
  if (!value || typeof value !== "object") throw new Error("tool output is not an object");
  const result = value as Partial<ScoringOutput>;
  if (!WORK_CATEGORIES.includes(result.work_category as WorkCategory)) {
    throw new Error(`invalid work category: ${String(result.work_category)}`);
  }
  if (typeof result.immediate_threat !== "boolean") throw new Error("immediate_threat must be boolean");
  if (
    !Array.isArray(result.visible_hazard_signals) ||
    result.visible_hazard_signals.length > 5 ||
    !result.visible_hazard_signals.every((signal) => typeof signal === "string")
  ) {
    throw new Error("visible_hazard_signals must be an array of at most five strings");
  }
  if (result.immediate_threat && result.visible_hazard_signals.length === 0) {
    throw new Error("immediate_threat requires at least one visible hazard signal");
  }
  if (typeof result.reason !== "string" || !result.reason.trim()) throw new Error("reason is required");
  if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) {
    throw new Error("confidence must be between 0 and 1");
  }
  if (result.missing_detail !== null && typeof result.missing_detail !== "string") {
    throw new Error("missing_detail must be a string or null");
  }
  if (typeof result.photo_shows_tree_hazard !== "boolean") {
    throw new Error("photo_shows_tree_hazard must be boolean");
  }
  if (!result.photo_shows_tree_hazard && !result.missing_detail?.trim()) {
    throw new Error("missing_detail is required when the photo does not show a tree hazard");
  }
  if (!result.photo_shows_tree_hazard && result.immediate_threat) {
    throw new Error("an unrelated photo cannot establish an immediate threat");
  }
  return result as ScoringOutput;
}

type ToolRequester = (input: ScoringInput, validationFailure?: string) => Promise<unknown>;

async function requestFromClaude(input: ScoringInput, validationFailure?: string): Promise<unknown> {
  const content: Anthropic.MessageParam["content"] = [{ type: "text", text: buildContextBlock(input) }];
  if (validationFailure) {
    content.push({
      type: "text",
      text: `Your previous tool result was invalid: ${validationFailure}. Return a corrected submit_triage call.`,
    });
  }

  if (input.photoBase64 && input.photoMediaType) {
    content.unshift({
      type: "image",
      source: { type: "base64", media_type: input.photoMediaType as any, data: input.photoBase64 },
    });
  }

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_triage" },
    messages: [{ role: "user", content }],
  });

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a submit_triage tool call");
  return toolUse.input;
}

export async function scoreReport(
  input: ScoringInput,
  requester: ToolRequester = requestFromClaude,
): Promise<ScoringOutput> {
  try {
    return parseScoringOutput(await requester(input));
  } catch (firstError) {
    try {
      return parseScoringOutput(await requester(input, (firstError as Error).message));
    } catch (secondError) {
      throw new Error(`AI_UNAVAILABLE: ${(secondError as Error).message}`, { cause: secondError });
    }
  }
}
