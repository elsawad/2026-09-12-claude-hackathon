import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { getLayer } from "./dataLayers.js";
import type { LandStatus, LandStatusSource } from "./types.js";

// --- Decisions made now, written down (per build-plan Step 3) ---
// Street centreline buffer: 10m either side of the line. HRM's ROW for a
// local street is roughly this width; a report inside it is treated as a
// public right-of-way rather than a private-property complaint.
export const STREET_ROW_BUFFER_M = 10;
// Utility proximity buffer: 30m. Erring wide on purpose — the build plan is
// explicit that a false positive here costs an officer ten seconds to
// downgrade, while a false negative could mean a downed line goes unflagged.
export const UTILITY_EMERGENCY_BUFFER_M = 30;

export async function isInsideHRM(lat: number, lng: number): Promise<boolean> {
  const boundary = await getLayer("municipalBoundary");
  if (!boundary) return true; // fail open: don't block a real report over a data outage
  const pt = turf.point([lng, lat]);
  return boundary.features.some((f) => safeBooleanPointInPolygon(pt, f));
}

function safeBooleanPointInPolygon(pt: Feature<any>, polygonFeature: Feature<any>): boolean {
  try {
    if (
      polygonFeature.geometry?.type !== "Polygon" &&
      polygonFeature.geometry?.type !== "MultiPolygon"
    ) {
      return false;
    }
    return turf.booleanPointInPolygon(pt, polygonFeature as Feature<any>);
  } catch {
    return false;
  }
}

function nearestLineDistanceM(pt: Feature<any>, feature: Feature<any>): number | null {
  try {
    const geom = feature.geometry;
    if (geom.type === "LineString") {
      return turf.pointToLineDistance(pt, feature as any, { units: "meters" });
    }
    if (geom.type === "MultiLineString") {
      let min = Infinity;
      for (const coords of geom.coordinates) {
        const line = turf.lineString(coords);
        min = Math.min(min, turf.pointToLineDistance(pt, line, { units: "meters" }));
      }
      return min;
    }
  } catch {
    // fall through
  }
  return null;
}

export interface LandStatusResult {
  status: LandStatus;
  detail: string | null; // e.g. park name or street name, for the officer console
}

/**
 * Public/private proxy per PRD 5.2: HRM Park polygon first, then street
 * centreline buffer, else default to private ("ambiguous" only when we
 * genuinely couldn't load a layer at all).
 */
export async function getLandStatus(lat: number, lng: number): Promise<LandStatusResult> {
  const [parks, streets] = await Promise.all([getLayer("parks"), getLayer("streetCentreline")]);
  const pt = turf.point([lng, lat]);

  if (parks) {
    for (const feature of parks.features) {
      if (safeBooleanPointInPolygon(pt, feature)) {
        const name = (feature.properties as any)?.PARK_NAME ?? "HRM park";
        return { status: "public_park", detail: name };
      }
    }
  }

  if (streets) {
    for (const feature of streets.features) {
      const dist = nearestLineDistanceM(pt, feature);
      if (dist !== null && dist <= STREET_ROW_BUFFER_M) {
        const name = (feature.properties as any)?.FULL_NAME ?? (feature.properties as any)?.STR_NAME ?? "a street right-of-way";
        return { status: "right_of_way", detail: name };
      }
    }
  }

  if (!parks && !streets) {
    return { status: "ambiguous", detail: "land layers unavailable — could not check" };
  }

  return { status: "private", detail: null };
}

export type QuestionnaireLocationAnswer =
  | "street_or_sidewalk"
  | "public_park"
  | "private_property"
  | "not_sure";

export interface ResolvedLandStatus {
  status: LandStatus;
  source: LandStatusSource;
  divertPrivate: boolean;
}

const PUBLIC_STATUSES: LandStatus[] = ["public_park", "right_of_way"];

/**
 * PRD 5.2 + build-plan Step 8: geometry proxy is automatic, the
 * questionnaire is the human's say-so, and the two are reconciled rather
 * than one blindly overriding the other. Only an explicit agreement that
 * the land is private triggers the diversion (log as diverted_private,
 * never enter the work queue) — any disagreement is left visible for the
 * model/officer rather than resolved silently.
 */
export function resolveLandStatus(
  geometry: LandStatusResult,
  questionnaire: QuestionnaireLocationAnswer | null
): ResolvedLandStatus {
  if (!questionnaire || questionnaire === "not_sure") {
    return { status: geometry.status, source: "geometry", divertPrivate: false };
  }

  const questionnaireIsPublic = questionnaire === "street_or_sidewalk" || questionnaire === "public_park";
  const questionnaireIsPrivate = questionnaire === "private_property";
  const geometryIsPublic = PUBLIC_STATUSES.includes(geometry.status);
  const geometryIsPrivate = geometry.status === "private";

  if (geometryIsPrivate && questionnaireIsPrivate) {
    return { status: "private", source: "both_agree", divertPrivate: true };
  }
  if (geometryIsPublic && questionnaireIsPublic) {
    return { status: geometry.status, source: "both_agree", divertPrivate: false };
  }
  if (geometry.status === "ambiguous") {
    return {
      status: questionnaireIsPrivate ? "private" : questionnaireIsPublic ? "right_of_way" : "ambiguous",
      source: "questionnaire",
      divertPrivate: false
    };
  }
  // Geometry and questionnaire disagree outright — surface it, don't divert.
  return { status: "ambiguous", source: "conflict", divertPrivate: false };
}

export interface UtilityProximityResult {
  distanceM: number;
  featureType: string;
  isEmergency: boolean;
}

const UTILITY_LAYER_KEYS = ["utilitiesLines", "utilitiesPoints", "utilitiesPolygons"] as const;

const FEAT_CODE_LABELS: Record<string, string> = {
  UTTR50: "transmission line",
  UTPI50: "pipeline",
  UTPI56: "pipeline",
  UTPI57: "pipeline",
  UTSS40: "substation",
  UTSS60: "substation",
  UTTO60: "tower",
  UTTO65: "tower",
  UTTK40: "tank",
  UTTK60: "tank",
  UTTK65: "tank"
};

function labelFor(feature: Feature<Geometry, any>): string {
  const code = feature.properties?.feat_code as string | undefined;
  if (code && FEAT_CODE_LABELS[code]) return FEAT_CODE_LABELS[code];
  return (feature.properties?.feat_desc as string) || code || "utility feature";
}

function polygonBoundaryDistanceM(pt: Feature<any>, feature: Feature<any>): number | null {
  try {
    if (safeBooleanPointInPolygon(pt, feature)) return 0;
    const line = turf.polygonToLine(feature as any);
    if (line.type === "FeatureCollection") {
      let min = Infinity;
      for (const f of line.features) min = Math.min(min, turf.pointToLineDistance(pt, f as any, { units: "meters" }));
      return min;
    }
    return turf.pointToLineDistance(pt, line as any, { units: "meters" });
  } catch {
    return null;
  }
}

/**
 * Nearest utility feature across all three NS Topographic Utilities layers
 * (lines/points/polygons). Returns the true nearest distance regardless of
 * the emergency threshold, so the officer console can always show the real
 * number — `isEmergency` is just UTILITY_EMERGENCY_BUFFER_M applied to it.
 */
export async function getUtilityProximity(lat: number, lng: number): Promise<UtilityProximityResult | null> {
  const layers = await Promise.all(UTILITY_LAYER_KEYS.map((k) => getLayer(k)));
  const pt = turf.point([lng, lat]);

  let best: UtilityProximityResult | null = null;

  for (const layer of layers) {
    if (!layer) continue;
    for (const feature of layer.features as Feature<Geometry, any>[]) {
      let dist: number | null = null;
      switch (feature.geometry?.type) {
        case "Point":
          dist = turf.distance(pt, feature as any, { units: "meters" });
          break;
        case "MultiPoint":
          dist = Math.min(
            ...(feature.geometry.coordinates as number[][]).map((c) =>
              turf.distance(pt, turf.point(c), { units: "meters" })
            )
          );
          break;
        case "LineString":
        case "MultiLineString":
          dist = nearestLineDistanceM(pt, feature);
          break;
        case "Polygon":
        case "MultiPolygon":
          dist = polygonBoundaryDistanceM(pt, feature);
          break;
      }
      if (dist !== null && (best === null || dist < best.distanceM)) {
        best = { distanceM: dist, featureType: labelFor(feature), isEmergency: dist <= UTILITY_EMERGENCY_BUFFER_M };
      }
    }
  }

  return best;
}
