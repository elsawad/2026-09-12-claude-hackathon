export const TIERS = [
  "utility_emergency",
  "imminent_hazard",
  "routine",
  "insufficient_info",
] as const;
export type Tier = (typeof TIERS)[number];

export type LandStatus = "public_park" | "right_of_way" | "private" | "ambiguous";
export type LandStatusSource = "geometry" | "questionnaire" | "both_agree" | "conflict";
export type ReviewState =
  | "awaiting_review"
  | "reviewed_accepted"
  | "reviewed_overridden"
  | "escalated";
export type ReportStatus =
  | "new"
  | "confirmed"
  | "stale"
  | "in_progress"
  | "resolved"
  | "diverted_private";

export type ActionName =
  | "accept"
  | "override"
  | "escalate"
  | "in_progress"
  | "resolve";

export const CATEGORIES = [
  "utility",
  "fallen",
  "hanging_limb",
  "pruning",
  "stump",
  "disease",
  "blockage",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Report = {
  id: string;
  created_at: string;
  reference_code: string;
  photo_url: string | null;
  lat: number;
  lng: number;
  location_source: string;
  block_location: string;
  district: string;
  category: Category;
  priority: Priority;
  notes: string;
  description_original: string;
  description_language: string;
  description_translated: string | null;
  translation_is_ai: boolean;
  questionnaire_location_answer: string;
  questionnaire_danger_answer: string;
  land_status: LandStatus;
  land_status_source: LandStatusSource;
  proposed_tier: Tier;
  reason: string;
  confidence: number;
  missing_detail: string | null;
  utility_proximity_m: number | null;
  utility_feature_type: string | null;
  wind_context: string;
  eab_flag: boolean;
  historical_pattern_note: string;
  confirmation_count: number;
  last_confirmed_at: string | null;
  review_state: ReviewState;
  final_tier: Tier | null;
  override_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  status: ReportStatus;
};

export type AuditEntry = {
  id: string;
  report_id: string;
  actor: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  timestamp: string;
};

export type Summary = {
  awaiting_review: number;
  awaiting_by_tier: Record<Tier, number>;
  utility_emergencies: number;
  new_since: number;
  deflected: number;
  escalated: number;
};

export const TIER_LABEL: Record<Tier, string> = {
  utility_emergency: "Utility emergency",
  imminent_hazard: "Imminent hazard",
  routine: "Routine",
  insufficient_info: "Insufficient info",
};

export const TIER_SLA: Record<Tier, string> = {
  utility_emergency: "Utility desk",
  imminent_hazard: "24 hour standard",
  routine: "Up to 12 months",
  insufficient_info: "Need more information",
};

export const REVIEW_LABEL: Record<ReviewState, string> = {
  awaiting_review: "Awaiting review",
  reviewed_accepted: "Accepted",
  reviewed_overridden: "Overridden",
  escalated: "Escalated",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  utility: "Utility",
  fallen: "Fallen tree",
  hanging_limb: "Hanging limb",
  pruning: "Pruning",
  stump: "Stump",
  disease: "Disease",
  blockage: "Blockage",
  other: "Other",
};
