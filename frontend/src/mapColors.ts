/**
 * Leaflet can't read CSS custom properties, so map colours live here and
 * mirror the tokens in index.css one-for-one. Keep the two in sync — a pin
 * that doesn't match its own badge is the fastest way to make one app look
 * like three.
 */

/** Matches --tier-* in index.css. */
export const TIER_COLORS: Record<string, string> = {
  utility_emergency: "#a3281c",
  imminent_hazard: "#b8590a",
  routine: "#3f6b3f",
  insufficient_info: "#5b5f52"
};

/** Matches --ok / --danger / --navy in index.css. */
export const MAP_COLORS = {
  onFill: "#3f6b3f",
  onStroke: "#2f5233",
  offFill: "#a3281c",
  offStroke: "#7a1e14",
  probeStroke: "#002b49"
} as const;
