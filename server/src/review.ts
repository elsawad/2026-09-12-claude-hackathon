import {
  ACTIONS,
  CATEGORIES,
  PRIORITIES,
  TIERS,
  type ActionInput,
  type AuditEntry,
  type Category,
  type Priority,
  type Report,
  type Summary,
  type Tier,
} from "./types.js";

export const TIER_RANK: Record<Tier, number> = {
  utility_emergency: 0,
  imminent_hazard: 1,
  insufficient_info: 2,
  routine: 3,
};

export const PRIORITY_RANK: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function inCityQueue(report: Report): boolean {
  return report.status !== "diverted_private";
}

export function snapshot(report: Report): Record<string, unknown> {
  return {
    review_state: report.review_state,
    final_tier: report.final_tier,
    override_reason: report.override_reason,
    status: report.status,
    reviewed_by: report.reviewed_by,
    reviewed_at: report.reviewed_at,
  };
}

export function tierFrom(priority: Priority, category: Category): Tier {
  if (category === "utility" && priority !== "low") return "utility_emergency";
  if (priority === "high") return "imminent_hazard";
  if (priority === "medium" && (category === "fallen" || category === "hanging_limb" || category === "blockage")) {
    return "imminent_hazard";
  }
  if (category === "other" && priority === "low") return "insufficient_info";
  return "routine";
}

export type SortKey = "priority" | "date" | "area";

function districtRank(district: string): number {
  const n = Number(district);
  return Number.isFinite(n) ? n : 999;
}

export function sortReports(reports: Report[], key: SortKey = "priority"): Report[] {
  return [...reports].sort((a, b) => {
    if (key === "date") return Date.parse(b.created_at) - Date.parse(a.created_at);
    if (key === "area") {
      const area = districtRank(a.district) - districtRank(b.district);
      if (area !== 0) return area;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    }
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    const ua = a.proposed_tier === "utility_emergency" && inCityQueue(a) ? 0 : 1;
    const ub = b.proposed_tier === "utility_emergency" && inCityQueue(b) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const rank = TIER_RANK[a.proposed_tier] - TIER_RANK[b.proposed_tier];
    if (rank !== 0) return rank;
    return b.confidence - a.confidence;
  });
}

export const NEARBY_M = 50;

export function metersApart(a: Report, b: Report): number {
  const r = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function clusterReports(reports: Report[], maxM = NEARBY_M): Report[][] {
  // ponytail: greedy 50m groups; union-find if volume makes order matter
  const clusters: Report[][] = [];
  for (const report of reports) {
    const hit = clusters.find((group) =>
      group.some((other) => metersApart(report, other) <= maxM),
    );
    if (hit) hit.push(report);
    else clusters.push([report]);
  }
  return clusters;
}

export function parseCategory(value: unknown): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : "other";
}

export function parsePriority(value: unknown): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : "medium";
}

export function summarize(reports: Report[], sinceIso: string | null): Summary {
  const awaiting_by_tier: Record<Tier, number> = {
    utility_emergency: 0,
    imminent_hazard: 0,
    routine: 0,
    insufficient_info: 0,
  };
  let awaiting_review = 0;
  let utility_emergencies = 0;
  let deflected = 0;
  let escalated = 0;
  let new_since = 0;
  const since = sinceIso ? Date.parse(sinceIso) : 0;

  for (const report of reports) {
    if (report.status === "diverted_private") {
      deflected += 1;
      continue;
    }
    if (report.review_state === "awaiting_review") {
      awaiting_review += 1;
      awaiting_by_tier[report.proposed_tier] += 1;
    }
    if (report.review_state === "escalated") escalated += 1;
    if (
      report.proposed_tier === "utility_emergency" &&
      (report.review_state === "awaiting_review" ||
        report.review_state === "escalated")
    ) {
      utility_emergencies += 1;
    }
    if (Date.parse(report.created_at) > since) new_since += 1;
  }

  return {
    awaiting_review,
    awaiting_by_tier,
    utility_emergencies,
    new_since,
    deflected,
    escalated,
  };
}

export function applyAction(
  report: Report,
  input: ActionInput,
  now = new Date().toISOString(),
  auditId = `aud_${Date.now()}`,
): { report: Report; audit: AuditEntry } {
  const officer = (input.officer_id || "").trim();
  if (!officer) throw new Error("officer_id is required");
  if (!ACTIONS.includes(input.action)) throw new Error("unknown action");

  const next = { ...report };
  const before = snapshot(report);

  if (input.action === "accept") {
    next.review_state = "reviewed_accepted";
    next.final_tier = report.proposed_tier;
    next.override_reason = null;
    next.reviewed_by = officer;
    next.reviewed_at = now;
  } else if (input.action === "override") {
    const reason = (input.override_reason || "").trim();
    if (!input.final_tier) throw new Error("final_tier is required to override");
    if (!TIERS.includes(input.final_tier)) throw new Error("invalid final_tier");
    if (!reason) throw new Error("override_reason is required");
    next.review_state = "reviewed_overridden";
    next.final_tier = input.final_tier;
    next.override_reason = reason;
    next.reviewed_by = officer;
    next.reviewed_at = now;
  } else if (input.action === "escalate") {
    next.review_state = "escalated";
    next.reviewed_by = officer;
    next.reviewed_at = now;
  } else if (input.action === "in_progress") {
    next.status = "in_progress";
    next.reviewed_by = officer;
    next.reviewed_at = now;
  } else if (input.action === "resolve") {
    next.status = "resolved";
    next.reviewed_by = officer;
    next.reviewed_at = now;
  }

  return {
    report: next,
    audit: {
      id: auditId,
      report_id: report.id,
      actor: officer,
      action: input.action,
      before,
      after: snapshot(next),
      timestamp: now,
    },
  };
}
