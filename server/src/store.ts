import {
  confirmReport as confirmReportRepo,
  getAuditLog,
  getReportById,
  getReportByReferenceCode,
  insertAuditLog,
  listReports as listReportsRepo,
  updateReview
} from "./reportsRepo.js";
import { applyAction, metersApart, NEARBY_M, snapshot, sortReports, summarize } from "./review.js";
import type { ActionInput, AuditEntry, Report, Summary } from "./types.js";

export async function listReports(sinceIso: string | null): Promise<{
  summary: Summary;
  reports: Report[];
}> {
  const reports = sortReports(await listReportsRepo());
  return { summary: summarize(reports, sinceIso), reports };
}

export async function getReport(id: string): Promise<{
  report: Report;
  audit: AuditEntry[];
  nearby: Report[];
} | null> {
  const report = await getReportById(id);
  if (!report) return null;
  const [audit, all] = await Promise.all([getAuditLog(id), listReportsRepo()]);
  return {
    report,
    audit,
    nearby: all.filter((row) => row.id !== id && metersApart(row, report) <= NEARBY_M)
  };
}

export async function reviewReport(
  id: string,
  input: ActionInput
): Promise<{ report: Report; audit: AuditEntry } | null> {
  const current = await getReportById(id);
  if (!current) return null;

  // applyAction is the pure state-transition function (validates the
  // action, requires a reason on override, etc.) — we run it against the
  // current row to get the field diff, then persist just that diff.
  const { report: next } = applyAction(current, input);

  const updated = await updateReview(id, {
    reviewState: next.review_state,
    finalTier: next.final_tier,
    overrideReason: next.override_reason,
    reviewedBy: next.reviewed_by ?? input.officer_id,
    status: next.status !== current.status ? next.status : undefined
  });
  if (!updated) return null;

  const audit = await insertAuditLog({
    report_id: id,
    actor: input.officer_id,
    action: input.action,
    before: snapshot(current),
    after: snapshot(updated)
  });

  return { report: updated, audit };
}

export async function getPublicReports(): Promise<
  { id: string; lat: number; lng: number; tier: string | null; status: string; confirmationCount: number; createdAt: string }[]
> {
  // Public map: block-level location only (rounded), no reporter identity,
  // ever existed to begin with.
  const blockLevel = (coord: number) => Math.round(coord * 800) / 800; // ~120-140m grid at Halifax's latitude
  const reports = await listReportsRepo();
  return reports
    .filter((r) => r.status !== "diverted_private")
    .map((r) => ({
      id: r.id,
      lat: blockLevel(r.lat),
      lng: blockLevel(r.lng),
      tier: r.review_state === "reviewed_overridden" ? r.final_tier : r.proposed_tier,
      status: r.status,
      confirmationCount: r.confirmation_count,
      createdAt: r.created_at
    }));
}

export async function confirmReport(id: string, sessionToken: string) {
  const report = await getReportById(id);
  if (!report) return null;
  return confirmReportRepo(id, sessionToken);
}

export async function lookupReportByCode(code: string) {
  const r = await getReportByReferenceCode(code.toUpperCase());
  if (!r) return null;
  return {
    referenceCode: r.reference_code,
    status: r.status,
    reviewState: r.review_state,
    tier: r.review_state === "reviewed_overridden" ? r.final_tier : r.proposed_tier,
    createdAt: r.created_at
  };
}
