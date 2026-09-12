import { useEffect, useMemo, useState } from "react";
import type { ActionName, AuditEntry, Priority, Report, Summary, Tier } from "../types";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  REVIEW_LABEL,
  TIER_LABEL,
  TIER_SLA,
  TIERS,
} from "../types";
import "./Console.css";

type Filter = "queue" | "escalated" | "reviewed" | "deflected";
type SortKey = "priority" | "date" | "area";

const LAST_KEY = "cw-last-checkin";
const SESSION_KEY = "cw-checkin-session";
const OFFICER_KEY = "cw-officer-id";
const NEARBY_M = 50;
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function lastCheckInIso(): string {
  let previous = sessionStorage.getItem(SESSION_KEY);
  if (previous === null) {
    previous = localStorage.getItem(LAST_KEY) || "1970-01-01T00:00:00.000Z";
    sessionStorage.setItem(SESSION_KEY, previous);
    localStorage.setItem(LAST_KEY, new Date().toISOString());
  }
  return previous;
}

function relTime(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function coords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function osmLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

function districtLabel(district: string): string {
  if (!district || district === "unknown") return "Area unknown";
  return `District ${district}`;
}

function metersApart(a: Report, b: Report): number {
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

function clusterReports(reports: Report[]): Report[][] {
  const clusters: Report[][] = [];
  for (const report of reports) {
    const hit = clusters.find((group) =>
      group.some((other) => metersApart(report, other) <= NEARBY_M),
    );
    if (hit) hit.push(report);
    else clusters.push([report]);
  }
  return clusters;
}

function sortRows(rows: Report[], key: SortKey): Report[] {
  return [...rows].sort((a, b) => {
    if (key === "date") return Date.parse(b.created_at) - Date.parse(a.created_at);
    if (key === "area") {
      const n = Number(a.district) - Number(b.district);
      if (Number.isFinite(n) && n !== 0) return n;
      return a.district.localeCompare(b.district);
    }
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

function matches(report: Report, filter: Filter): boolean {
  if (filter === "deflected") return report.status === "diverted_private";
  if (filter === "escalated") return report.review_state === "escalated";
  if (filter === "reviewed") {
    return (
      report.review_state === "reviewed_accepted" ||
      report.review_state === "reviewed_overridden"
    );
  }
  return (
    report.status !== "diverted_private" &&
    (report.review_state === "awaiting_review" ||
      report.review_state === "escalated")
  );
}

export default function Console() {
  const since = useMemo(lastCheckInIso, []);
  const [officer, setOfficer] = useState(
    () => localStorage.getItem(OFFICER_KEY) || "officer",
  );
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("queue");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [areaFilter, setAreaFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTier, setOverrideTier] = useState<Tier>("routine");
  const [overrideReason, setOverrideReason] = useState("");

  async function loadList(keepId?: string | null) {
    const res = await fetch(`/api/reports?since=${encodeURIComponent(since)}`);
    if (!res.ok) throw new Error("Could not load reports");
    const data = (await res.json()) as { summary: Summary; reports: Report[] };
    setSummary(data.summary);
    setReports(data.reports);
    setSelectedId((current) => {
      const want = keepId ?? current;
      if (want && data.reports.some((row) => row.id === want)) return want;
      return data.reports.find((row) => matches(row, "queue"))?.id ?? data.reports[0]?.id ?? null;
    });
  }

  useEffect(() => {
    loadList().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Load failed"),
    );
    const timer = window.setInterval(() => {
      loadList().catch(() => {});
    }, 8000);
    return () => window.clearInterval(timer);
  }, [since]);

  const areas = useMemo(() => {
    const found = new Set(reports.map((row) => row.district).filter(Boolean));
    return [...found].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  }, [reports]);

  const visible = sortRows(
    reports.filter(
      (row) => matches(row, filter) && (!areaFilter || row.district === areaFilter),
    ),
    sortKey,
  );
  const clusters = clusterReports(visible).map((group) => sortRows(group, sortKey));
  const selected =
    visible.find((row) => row.id === selectedId) ?? visible[0] ?? null;
  const nearby = selected
    ? reports.filter(
        (row) => row.id !== selected.id && metersApart(row, selected) <= NEARBY_M,
      )
    : [];

  useEffect(() => {
    const id = selected?.id;
    if (!id) {
      setAudit([]);
      return;
    }
    fetch(`/api/reports/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { audit: AuditEntry[] } | null) => {
        if (data) setAudit(data.audit);
      })
      .catch(() => {});
    setOverrideOpen(false);
    setOverrideReason("");
  }, [selected?.id]);

  async function act(action: ActionName, extra: Record<string, string> = {}) {
    if (!selected) return;
    const name = officer.trim();
    if (!name) {
      setError("Put your initials in the header so the audit log has a name.");
      return;
    }
    localStorage.setItem(OFFICER_KEY, name);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${selected.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, officer_id: name, ...extra }),
      });
      const data = (await res.json()) as { error?: string; audit?: AuditEntry };
      if (!res.ok) throw new Error(data.error || "Action failed");
      if (data.audit) setAudit((prev) => [...prev, data.audit!]);
      await loadList(selected.id);
      setOverrideOpen(false);
      setOverrideReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console">
      <div className="brand-ribbon">Halifax Regional Municipality — community pilot project</div>
      <header className="header">
        <a className="brand-btn" href="/">
          <span className="wordmark">Halifax</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-product">Canopy Watch</span>
        </a>
        <nav>
          <a href="/report">Report</a>
          <a href="/land">Land check</a>
          <a className="nav-active" href="/console" aria-current="page">
            City console
          </a>
        </nav>
      </header>

      <header className="console-head">
        <div>
          <p className="eyebrow">Urban Forestry</p>
          <h1>City console</h1>
        </div>
        <label className="officer">
          Officer
          <input
            value={officer}
            onChange={(e) => setOfficer(e.target.value)}
            onBlur={() => localStorage.setItem(OFFICER_KEY, officer.trim())}
            autoComplete="username"
          />
        </label>
      </header>

      <p className="strip">
        {summary
          ? `${summary.awaiting_review} awaiting review · ${summary.utility_emergencies} utility · ${summary.new_since} new · ${summary.deflected} deflected`
          : "Loading queue"}
      </p>

      {error ? <p className="banner">{error}</p> : null}

      <div className="workspace">
        <aside className="queue">
          <div className="filters" role="tablist">
            {(
              [
                ["queue", "Queue"],
                ["escalated", "Escalated"],
                ["reviewed", "Reviewed"],
                ["deflected", "Deflected"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                className={filter === id ? "chip on" : "chip"}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="queue-tools">
            <label>
              Sort
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="priority">Priority</option>
                <option value="date">Newest</option>
                <option value="area">Area</option>
              </select>
            </label>
            <label>
              Area
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
              >
                <option value="">All areas</option>
                {areas.map((area) => (
                  <option key={area} value={area}>
                    {districtLabel(area)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul>
            {clusters.length === 0 ? (
              <li className="empty-row">Nothing in this list.</li>
            ) : (
              clusters.map((group) => {
                const lead = group[0];
                if (!lead) return null;
                return (
                  <li key={lead.id} className="group">
                    {group.length > 1 ? (
                      <p className="group-head">
                        {group.length} nearby · {lead.block_location}
                      </p>
                    ) : null}
                    {group.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className={row.id === selected?.id ? "row on" : "row"}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <span className={`pri p-${row.priority}`}>
                          {PRIORITY_LABEL[row.priority]}
                        </span>
                        <span className="row-main">
                          <strong>
                            {CATEGORY_LABEL[row.category]}
                            {group.length === 1 ? ` · ${row.block_location}` : ""}
                          </strong>
                          <span>
                            {coords(row.lat, row.lng)} · {relTime(row.created_at)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        <section className="detail">
          {selected ? (
            <Detail
              report={selected}
              nearby={nearby}
              audit={audit}
              busy={busy}
              overrideOpen={overrideOpen}
              overrideTier={overrideTier}
              overrideReason={overrideReason}
              onSelect={setSelectedId}
              onOverrideOpen={() => {
                setOverrideTier(selected.proposed_tier);
                setOverrideOpen(true);
              }}
              onOverrideTier={setOverrideTier}
              onOverrideReason={setOverrideReason}
              onAct={act}
            />
          ) : (
            <p className="empty-detail">Select a report.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Detail({
  report,
  nearby,
  audit,
  busy,
  overrideOpen,
  overrideTier,
  overrideReason,
  onSelect,
  onOverrideOpen,
  onOverrideTier,
  onOverrideReason,
  onAct,
}: {
  report: Report;
  nearby: Report[];
  audit: AuditEntry[];
  busy: boolean;
  overrideOpen: boolean;
  overrideTier: Tier;
  overrideReason: string;
  onSelect: (id: string) => void;
  onOverrideOpen: () => void;
  onOverrideTier: (tier: Tier) => void;
  onOverrideReason: (reason: string) => void;
  onAct: (action: ActionName, extra?: Record<string, string>) => Promise<void>;
}) {
  const locked = report.status === "diverted_private";
  return (
    <>
      <p className="ref">{report.reference_code}</p>
      <h2>{report.block_location}</h2>
      <p className="sla">
        {PRIORITY_LABEL[report.priority]} · {CATEGORY_LABEL[report.category]} ·{" "}
        {districtLabel(report.district)}
      </p>

      <dl className="facts">
        <div>
          <dt>Coordinates</dt>
          <dd>
            <a href={osmLink(report.lat, report.lng)} target="_blank" rel="noreferrer">
              {coords(report.lat, report.lng)}
            </a>
          </dd>
        </div>
        <div>
          <dt>HRM standard</dt>
          <dd>
            {TIER_LABEL[report.proposed_tier]}
            <small>{TIER_SLA[report.proposed_tier]}</small>
          </dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{REVIEW_LABEL[report.review_state]}</dd>
        </div>
        <div>
          <dt>Photo</dt>
          <dd>
            {report.photo_url ? (
              <a href={report.photo_url} target="_blank" rel="noreferrer">
                View photo
              </a>
            ) : (
              "None"
            )}
          </dd>
        </div>
      </dl>

      <h3>Description</h3>
      <p className="copy">{report.description_original || "No description."}</p>
      {report.description_translated ? (
        <p className="copy muted">
          {report.description_translated}
          {report.translation_is_ai ? " (AI translation)" : ""}
        </p>
      ) : null}

      <h3>Notes</h3>
      <p className="copy">{report.notes || "No notes."}</p>
      {report.reason ? <p className="copy muted">{report.reason}</p> : null}

      {nearby.length > 0 ? (
        <div className="nearby">
          <h3>Nearby work orders</h3>
          <ul>
            {nearby.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => onSelect(row.id)}>
                  {row.reference_code} · {PRIORITY_LABEL[row.priority]} ·{" "}
                  {CATEGORY_LABEL[row.category]} · {Math.round(metersApart(row, report))} m
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.final_tier ? (
        <p className="decision">
          Decision: {TIER_LABEL[report.final_tier]}
          {report.reviewed_by ? ` · ${report.reviewed_by}` : ""}
          {report.override_reason ? ` — ${report.override_reason}` : ""}
        </p>
      ) : null}

      <div className="actions">
        <button type="button" disabled={busy || locked} onClick={() => onAct("accept")}>
          Accept
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || locked}
          onClick={onOverrideOpen}
        >
          Override
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || locked}
          onClick={() => onAct("escalate")}
        >
          Escalate
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || locked}
          onClick={() => onAct("in_progress")}
        >
          In progress
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || locked}
          onClick={() => onAct("resolve")}
        >
          Resolve
        </button>
      </div>

      {overrideOpen ? (
        <form
          className="override"
          onSubmit={(event) => {
            event.preventDefault();
            void onAct("override", {
              final_tier: overrideTier,
              override_reason: overrideReason,
            });
          }}
        >
          <label>
            New standard
            <select
              value={overrideTier}
              onChange={(e) => onOverrideTier(e.target.value as Tier)}
            >
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {TIER_LABEL[tier]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <textarea
              required
              rows={2}
              value={overrideReason}
              onChange={(e) => onOverrideReason(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Record override
          </button>
        </form>
      ) : null}

      {locked ? <p className="note">Deflected. Logged only.</p> : null}

      <div className="audit">
        <h3>Audit</h3>
        {audit.length === 0 ? (
          <p>No human action yet.</p>
        ) : (
          <ol>
            {audit.map((entry) => (
              <li key={entry.id}>
                {relTime(entry.timestamp)} · {entry.actor} · {entry.action}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
