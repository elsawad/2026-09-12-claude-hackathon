export type Tier =
  | "utility_emergency"
  | "imminent_hazard"
  | "routine"
  | "insufficient_info";

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

export type LocationSource = "exif" | "geolocation" | "map_pin" | "typed_address";

export interface Report {
  id: string;
  created_at: string;
  reference_code: string;

  photo_url: string | null;
  lat: number;
  lng: number;
  location_source: LocationSource;

  description_original: string | null;
  description_language: string | null;
  description_translated: string | null;
  translation_is_ai: boolean;

  questionnaire_location_answer: string | null;
  questionnaire_danger_answer: string | null;

  land_status: LandStatus;
  land_status_source: LandStatusSource;

  proposed_tier: Tier | null;
  reason: string | null;
  confidence: number | null;
  missing_detail: string | null;

  utility_proximity_m: number | null;
  utility_feature_type: string | null;

  wind_context: string | null;
  eab_flag: boolean;

  historical_pattern_note: string | null;

  confirmation_count: number;
  last_confirmed_at: string | null;

  review_state: ReviewState;
  final_tier: Tier | null;
  override_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;

  status: ReportStatus;

  pre_flagged_urgent: boolean;
}

export interface AuditLogEntry {
  id: string;
  report_id: string;
  actor: string;
  action: string;
  before: string | null;
  after: string | null;
  timestamp: string;
}

export interface ScoringInput {
  description: string | null;
  descriptionLanguage: string | null;
  questionnaireLocationAnswer: string | null;
  questionnaireDangerAnswer: string | null;
  landStatus: LandStatus;
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
  proposed_tier: Tier;
  reason: string;
  confidence: number;
  missing_detail: string | null;
  photo_shows_tree_hazard: boolean;
}
