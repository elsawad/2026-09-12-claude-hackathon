import { dbPromise, generateReferenceCode } from "./db.js";
import { tierFrom } from "./review.js";
import type {
  AuditEntry,
  Category,
  LandStatus,
  LandStatusSource,
  Priority,
  Report,
  ReportStatus,
  ReviewState,
  Tier
} from "./types.js";

function row(r: any): Report {
  return {
    id: r.id,
    created_at: r.created_at,
    reference_code: r.reference_code,
    photo_url: r.photo_url,
    lat: r.lat,
    lng: r.lng,
    location_source: r.location_source,
    block_location: r.block_location,
    district: r.district,
    category: r.category,
    priority: r.priority,
    notes: r.notes,
    description_original: r.description_original,
    description_language: r.description_language,
    description_translated: r.description_translated,
    translation_is_ai: r.translation_is_ai,
    questionnaire_location_answer: r.questionnaire_location_answer,
    questionnaire_danger_answer: r.questionnaire_danger_answer,
    land_status: r.land_status,
    land_status_source: r.land_status_source,
    proposed_tier: r.proposed_tier,
    reason: r.reason,
    confidence: r.confidence,
    missing_detail: r.missing_detail,
    utility_proximity_m: r.utility_proximity_m,
    utility_feature_type: r.utility_feature_type,
    wind_context: r.wind_context,
    eab_flag: r.eab_flag,
    historical_pattern_note: r.historical_pattern_note,
    confirmation_count: r.confirmation_count,
    last_confirmed_at: r.last_confirmed_at,
    review_state: r.review_state,
    final_tier: r.final_tier,
    override_reason: r.override_reason,
    reviewed_by: r.reviewed_by,
    reviewed_at: r.reviewed_at,
    status: r.status
  };
}

function auditRow(r: any): AuditEntry {
  return {
    id: r.id,
    report_id: r.report_id,
    actor: r.actor,
    action: r.action,
    before: r.before ? JSON.parse(r.before) : {},
    after: r.after ? JSON.parse(r.after) : {},
    timestamp: r.timestamp
  };
}

export interface NewReportInput {
  photoUrl: string | null;
  lat: number;
  lng: number;
  locationSource: string;
  blockLocation: string;
  district: string;
  descriptionOriginal: string | null;
  descriptionLanguage: string | null;
  descriptionTranslated: string | null;
  translationIsAi: boolean;
  questionnaireLocationAnswer: string | null;
  questionnaireDangerAnswer: string | null;
  landStatus: LandStatus;
  landStatusSource: LandStatusSource;
  category: Category;
  priority: Priority;
  proposedTier?: Tier;
  reason: string | null;
  confidence: number | null;
  missingDetail: string | null;
  utilityProximityM: number | null;
  utilityFeatureType: string | null;
  windContext: string | null;
  eabFlag: boolean;
  historicalPatternNote: string | null;
  status: ReportStatus;
  /** Seed-data only — real submissions always default to now(). */
  createdAt?: string;
}

export async function insertReport(input: NewReportInput): Promise<Report> {
  const db = await dbPromise;
  const referenceCode = generateReferenceCode();
  const proposedTier: Tier = input.proposedTier ?? tierFrom(input.priority, input.category);
  const result = await db.query(
    `INSERT INTO reports (
      created_at,
      reference_code, photo_url, lat, lng, location_source, block_location, district,
      category, priority, notes,
      description_original, description_language, description_translated, translation_is_ai,
      questionnaire_location_answer, questionnaire_danger_answer,
      land_status, land_status_source, proposed_tier,
      reason, confidence, missing_detail,
      utility_proximity_m, utility_feature_type,
      wind_context, eab_flag, historical_pattern_note,
      status
    ) VALUES (COALESCE($1, now()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
    RETURNING *`,
    [
      input.createdAt ?? null,
      referenceCode,
      input.photoUrl,
      input.lat,
      input.lng,
      input.locationSource,
      input.blockLocation,
      input.district,
      input.category,
      input.priority,
      "",
      input.descriptionOriginal,
      input.descriptionLanguage,
      input.descriptionTranslated,
      input.translationIsAi,
      input.questionnaireLocationAnswer,
      input.questionnaireDangerAnswer,
      input.landStatus,
      input.landStatusSource,
      proposedTier,
      input.reason,
      input.confidence,
      input.missingDetail,
      input.utilityProximityM,
      input.utilityFeatureType,
      input.windContext,
      input.eabFlag,
      input.historicalPatternNote,
      input.status
    ]
  );
  return row(result.rows[0]);
}

export async function getReportById(id: string): Promise<Report | null> {
  const db = await dbPromise;
  const result = await db.query(`SELECT * FROM reports WHERE id = $1`, [id]);
  return result.rows[0] ? row(result.rows[0]) : null;
}

export async function getReportByReferenceCode(code: string): Promise<Report | null> {
  const db = await dbPromise;
  const result = await db.query(`SELECT * FROM reports WHERE reference_code = $1`, [code]);
  return result.rows[0] ? row(result.rows[0]) : null;
}

/** Public map + officer queue both read from this; callers filter fields as needed. */
export async function listReports(): Promise<Report[]> {
  const db = await dbPromise;
  const result = await db.query(`SELECT * FROM reports ORDER BY created_at DESC`);
  return result.rows.map(row);
}

const EARTH_RADIUS_M = 6371000;

/** Nearby-duplicate check (~50m) against OUR OWN reports, not HRM's historical data. */
export async function findNearbyReport(lat: number, lng: number, radiusM = 50): Promise<Report | null> {
  const db = await dbPromise;
  // Cheap bounding-box prefilter in SQL, exact haversine check in JS (no PostGIS either way).
  const degLat = radiusM / 111_320;
  const degLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const result = await db.query<any>(
    `SELECT * FROM reports
     WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
       AND status NOT IN ('diverted_private', 'resolved', 'stale')
     ORDER BY created_at DESC`,
    [lat - degLat, lat + degLat, lng - degLng, lng + degLng]
  );
  const toRad = (d: number) => (d * Math.PI) / 180;
  for (const r of result.rows) {
    const dLat = toRad(r.lat - lat);
    const dLng = toRad(r.lng - lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(r.lat)) * Math.sin(dLng / 2) ** 2;
    const distance = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
    if (distance <= radiusM) return row(r);
  }
  return null;
}

export async function confirmReport(reportId: string, sessionToken: string): Promise<{ ok: boolean; alreadyConfirmed: boolean }> {
  const db = await dbPromise;
  const existing = await db.query(`SELECT 1 FROM confirmations WHERE report_id = $1 AND session_token = $2`, [
    reportId,
    sessionToken
  ]);
  if (existing.rows.length > 0) return { ok: true, alreadyConfirmed: true };

  await db.query(`INSERT INTO confirmations (report_id, session_token) VALUES ($1, $2)`, [reportId, sessionToken]);
  await db.query(
    `UPDATE reports SET confirmation_count = confirmation_count + 1, last_confirmed_at = now(),
       status = CASE WHEN status = 'new' THEN 'confirmed' ELSE status END
     WHERE id = $1`,
    [reportId]
  );
  return { ok: true, alreadyConfirmed: false };
}

export async function updateReview(
  reportId: string,
  fields: {
    reviewState: ReviewState;
    finalTier?: Tier | null;
    overrideReason?: string | null;
    reviewedBy: string;
    status?: ReportStatus;
  }
): Promise<Report | null> {
  const db = await dbPromise;
  const result = await db.query(
    `UPDATE reports SET
       review_state = $2,
       final_tier = COALESCE($3, final_tier),
       override_reason = $4,
       reviewed_by = $5,
       reviewed_at = now(),
       status = COALESCE($6, status)
     WHERE id = $1
     RETURNING *`,
    [reportId, fields.reviewState, fields.finalTier ?? null, fields.overrideReason ?? null, fields.reviewedBy, fields.status ?? null]
  );
  return result.rows[0] ? row(result.rows[0]) : null;
}

export async function insertAuditLog(entry: {
  report_id: string;
  actor: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): Promise<AuditEntry> {
  const db = await dbPromise;
  const result = await db.query(
    `INSERT INTO audit_log (report_id, actor, action, before, after) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [entry.report_id, entry.actor, entry.action, entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null]
  );
  return auditRow(result.rows[0]);
}

export async function getAuditLog(reportId: string): Promise<AuditEntry[]> {
  const db = await dbPromise;
  const result = await db.query(`SELECT * FROM audit_log WHERE report_id = $1 ORDER BY timestamp ASC`, [reportId]);
  return result.rows.map(auditRow);
}
