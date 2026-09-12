import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  clusterReports,
  metersApart,
  NEARBY_M,
  parseCategory,
  parsePriority,
  sortReports,
  summarize,
  tierFrom,
} from "./review.js";
import type {
  ActionInput,
  AuditEntry,
  Category,
  Priority,
  Report,
  Summary,
} from "./types.js";
import { TIERS, type Tier } from "./types.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data/state.json");

type State = { version: number; reports: Report[]; audit: AuditEntry[]; seq: number };

const SCHEMA = 3;

let state: State = { version: 0, reports: [], audit: [], seq: 1 };

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function item(
  partial: Partial<Report> &
    Pick<
      Report,
      | "id"
      | "reference_code"
      | "lat"
      | "lng"
      | "block_location"
      | "district"
      | "category"
      | "priority"
      | "description_original"
    >,
): Report {
  const category = partial.category;
  const priority = partial.priority;
  return {
    created_at: hoursAgo(4),
    photo_url: null,
    location_source: "image",
    notes: "",
    description_language: "en",
    description_translated: null,
    translation_is_ai: false,
    questionnaire_location_answer: "not sure",
    questionnaire_danger_answer: "not sure",
    land_status: "right_of_way",
    land_status_source: "geometry",
    proposed_tier: tierFrom(priority, category),
    reason: "",
    confidence: 0.8,
    missing_detail: null,
    utility_proximity_m: null,
    utility_feature_type: null,
    wind_context: "",
    eab_flag: false,
    historical_pattern_note: "",
    confirmation_count: 0,
    last_confirmed_at: null,
    review_state: "awaiting_review",
    final_tier: null,
    override_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    status: "new",
    ...partial,
  };
}

function seed(): Report[] {
  return [
    item({
      id: "rep_01",
      created_at: hoursAgo(1.2),
      reference_code: "CW-4F2K",
      lat: 44.6478,
      lng: -63.6019,
      block_location: "Quinpool Rd near Windsor St",
      district: "8",
      category: "utility",
      priority: "high",
      notes: "Image model: branch in contact with overhead line.",
      description_original:
        "Large branch resting on the overhead line above the sidewalk.",
      land_status: "right_of_way",
      land_status_source: "both_agree",
      proposed_tier: "utility_emergency",
      reason: "Utility contact. Not a prune job.",
      confidence: 0.93,
      utility_proximity_m: 8,
      utility_feature_type: "transmission_line",
      status: "confirmed",
    }),
    item({
      id: "rep_02",
      created_at: hoursAgo(3),
      reference_code: "CW-9C1M",
      lat: 44.6591,
      lng: -63.5994,
      block_location: "Agricola St near North St",
      district: "8",
      category: "hanging_limb",
      priority: "high",
      notes: "Split limb over the front of a house.",
      description_original: "A split limb is hanging over the front of the house.",
      proposed_tier: "imminent_hazard",
      reason: "Failed limb over a structure. 24-hour standard.",
      confidence: 0.86,
    }),
    item({
      id: "rep_02b",
      created_at: hoursAgo(2.4),
      reference_code: "CW-9C1N",
      lat: 44.65922,
      lng: -63.59948,
      block_location: "Agricola St near North St",
      district: "8",
      category: "pruning",
      priority: "medium",
      notes: "Second image, same canopy. Clearance over the sidewalk.",
      description_original: "Same tree, another angle. Branches over the sidewalk.",
      proposed_tier: "routine",
      reason: "Same site as CW-9C1M. Clearance prune unless the split fails.",
      confidence: 0.74,
    }),
    item({
      id: "rep_03",
      created_at: hoursAgo(5.5),
      reference_code: "CW-2H8P",
      lat: 44.6255,
      lng: -63.5658,
      block_location: "Point Pleasant Park, south entrance",
      district: "7",
      category: "fallen",
      priority: "high",
      notes: "Path blocked; pedestrians stepping into the roadway.",
      description_original: "Tree down across the path.",
      land_status: "public_park",
      land_status_source: "both_agree",
      proposed_tier: "imminent_hazard",
      reason: "Fallen tree pushing people into the road.",
      confidence: 0.9,
      status: "confirmed",
    }),
    item({
      id: "rep_04",
      created_at: hoursAgo(8),
      reference_code: "CW-7L3R",
      lat: 44.6512,
      lng: -63.585,
      block_location: "Gottingen St near Cunard St",
      district: "7",
      category: "other",
      priority: "low",
      notes: "Image unclear. Need a wider shot.",
      description_original: "árbol malo creo",
      description_language: "es",
      description_translated: "bad tree I think",
      translation_is_ai: true,
      land_status: "ambiguous",
      land_status_source: "conflict",
      proposed_tier: "insufficient_info",
      reason: "Photo does not show the tree or the target.",
      confidence: 0.41,
      missing_detail: "Need a photo of the whole tree and what it could hit.",
    }),
    item({
      id: "rep_05",
      created_at: hoursAgo(2.4),
      reference_code: "CW-5G7X",
      lat: 44.67118,
      lng: -63.5815,
      block_location: "George St near Portland St, Dartmouth",
      district: "5",
      category: "hanging_limb",
      priority: "high",
      notes: "Sidewalk target, downtown Dartmouth.",
      description_original: "Limb cracked over the sidewalk beside the plaza.",
      proposed_tier: "imminent_hazard",
      reason: "Failed limb over a sidewalk. 24-hour standard.",
      confidence: 0.84,
    }),
    item({
      id: "rep_06",
      created_at: hoursAgo(11),
      reference_code: "CW-16M4",
      lat: 44.74096,
      lng: -63.65112,
      block_location: "Riverview Cres, Bedford",
      district: "16",
      category: "stump",
      priority: "low",
      notes: "Boulevard stump, no target.",
      description_original: "Stump from last year's takedown still in the boulevard.",
      proposed_tier: "routine",
      reason: "Stump in the right of way. 12-month standard.",
      confidence: 0.8,
    }),
    item({
      id: "rep_07",
      created_at: hoursAgo(28),
      reference_code: "CW-1A9V",
      lat: 44.6704,
      lng: -63.6091,
      block_location: "Kencrest Ave near Lady Hammond Rd",
      district: "8",
      category: "pruning",
      priority: "medium",
      notes: "Bus shelter clearance.",
      description_original: "Needs a trim, brushing the roof of the bus shelter.",
      proposed_tier: "routine",
      reason: "Clearance prune. No failure indicators.",
      confidence: 0.81,
      review_state: "reviewed_accepted",
      final_tier: "routine",
      reviewed_by: "a.desroches",
      reviewed_at: hoursAgo(18),
      status: "in_progress",
    }),
    item({
      id: "rep_08",
      created_at: hoursAgo(6),
      reference_code: "CW-3B6W",
      lat: 44.6635,
      lng: -63.6122,
      block_location: "North End backyard, near Fullerton Ave",
      district: "8",
      category: "other",
      priority: "low",
      notes: "Private property. Diverted.",
      description_original: "Neighbour's tree is dropping stuff on my deck.",
      questionnaire_location_answer: "on private property",
      land_status: "private",
      land_status_source: "both_agree",
      proposed_tier: "routine",
      reason: "Private property. Not a city work item.",
      confidence: 0.88,
      status: "diverted_private",
    }),
  ];
}

function load() {
  try {
    const raw = JSON.parse(readFileSync(DATA, "utf8")) as State;
    if (raw.version === SCHEMA && Array.isArray(raw.reports) && Array.isArray(raw.audit)) {
      state = raw;
      return;
    }
  } catch {
    // first run or empty file
  }
  state = { version: SCHEMA, reports: seed(), audit: [], seq: 20 };
  persist();
}

function persist() {
  mkdirSync(dirname(DATA), { recursive: true });
  writeFileSync(DATA, JSON.stringify(state, null, 2));
}

load();

export function listReports(sinceIso: string | null): {
  summary: Summary;
  reports: Report[];
} {
  const reports = sortReports(state.reports);
  return { summary: summarize(reports, sinceIso), reports };
}

export function getReport(id: string): {
  report: Report;
  audit: AuditEntry[];
  nearby: Report[];
} | null {
  const report = state.reports.find((row) => row.id === id);
  if (!report) return null;
  return {
    report,
    audit: state.audit.filter((entry) => entry.report_id === id),
    nearby: state.reports.filter(
      (row) => row.id !== id && metersApart(row, report) <= NEARBY_M,
    ),
  };
}

export function reviewReport(id: string, input: ActionInput) {
  const index = state.reports.findIndex((row) => row.id === id);
  const current = state.reports[index];
  if (!current) return null;
  const result = applyAction(
    current,
    input,
    new Date().toISOString(),
    `aud_${state.seq++}`,
  );
  state.reports[index] = result.report;
  state.audit.push(result.audit);
  persist();
  return { report: result.report, audit: result.audit };
}

function refCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "CW-";
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

type IngestBody = Partial<Report> & {
  lat?: number;
  lng?: number;
  description?: string;
  photo?: string | null;
};

export function ingestReport(body: IngestBody): Report {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("lat and lng are required");
  }
  const category = parseCategory(body.category);
  const priority = parsePriority(body.priority);
  const land = body.land_status ?? "ambiguous";
  const qLoc = body.questionnaire_location_answer ?? "";
  const privateAgree = land === "private" && /private/i.test(qLoc);
  const proposed: Tier =
    body.proposed_tier && TIERS.includes(body.proposed_tier)
      ? body.proposed_tier
      : tierFrom(priority, category);
  const photo =
    body.photo_url === undefined && body.photo === undefined
      ? null
      : (body.photo_url ?? body.photo ?? null);
  const now = new Date().toISOString();
  const report: Report = {
    id: `rep_${String(state.seq++).padStart(2, "0")}`,
    created_at: now,
    reference_code: body.reference_code || refCode(),
    photo_url: photo || null,
    lat,
    lng,
    location_source: body.location_source || "image",
    block_location: body.block_location || "Location pending",
    district: body.district || "unknown",
    category,
    priority,
    notes: body.notes || "",
    description_original:
      body.description_original || body.description || "",
    description_language: body.description_language || "und",
    description_translated: body.description_translated ?? null,
    translation_is_ai: Boolean(body.translation_is_ai),
    questionnaire_location_answer: qLoc || "not sure",
    questionnaire_danger_answer: body.questionnaire_danger_answer || "not sure",
    land_status: land,
    land_status_source: body.land_status_source || "questionnaire",
    proposed_tier: proposed,
    reason: body.reason || "",
    confidence: typeof body.confidence === "number" ? body.confidence : 0,
    missing_detail: body.missing_detail ?? null,
    utility_proximity_m: body.utility_proximity_m ?? null,
    utility_feature_type: body.utility_feature_type ?? null,
    wind_context: body.wind_context || "",
    eab_flag: Boolean(body.eab_flag),
    historical_pattern_note: body.historical_pattern_note || "",
    confirmation_count: body.confirmation_count ?? 0,
    last_confirmed_at: body.last_confirmed_at ?? null,
    review_state: "awaiting_review",
    final_tier: null,
    override_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    status: privateAgree ? "diverted_private" : "new",
  };
  state.reports.push(report);
  state.audit.push({
    id: `aud_${state.seq++}`,
    report_id: report.id,
    actor: "model",
    action: privateAgree ? "divert_private" : "ingest",
    before: {},
    after: {
      category: report.category,
      priority: report.priority,
      proposed_tier: report.proposed_tier,
      status: report.status,
    },
    timestamp: now,
  });
  persist();
  return report;
}

export function nearbyGroups(reports: Report[] = state.reports) {
  return clusterReports(sortReports(reports));
}

export function resetStore() {
  state = { version: SCHEMA, reports: seed(), audit: [], seq: 20 };
  persist();
  return listReports(null);
}
