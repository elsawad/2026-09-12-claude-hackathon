import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getOfficerReports, getOfficerSummary } from "../lib/api";

const TIER_ICON: Record<string, string> = {
  utility_emergency: "⚡",
  imminent_hazard: "⚠️",
  routine: "🌳",
  insufficient_info: "❓"
};

export default function OfficerSummary() {
  const [summary, setSummary] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [filter, setFilter] = useState<"awaiting_review" | "all">("awaiting_review");
  const navigate = useNavigate();

  async function refresh() {
    const [s, r] = await Promise.all([getOfficerSummary(), getOfficerReports(filter === "awaiting_review" ? "awaiting_review" : undefined)]);
    setSummary(s);
    setReports(r);
  }

  useEffect(() => {
    refresh();
  }, [filter]);

  if (!summary) return <div className="screen center-note">Loading…</div>;

  return (
    <div className="screen">
      <div className="summary-grid">
        <StatTile n={summary.awaitingReviewTotal} label="Awaiting review" />
        <StatTile n={summary.utilityEmergencies} label="Utility emergencies" highlight />
        <StatTile n={summary.newSinceLastCheck} label="New (24h)" />
        <StatTile n={summary.deflectedCount} label="Deflected (never queued)" />
      </div>

      <div className="nav-tabs">
        <button className={filter === "awaiting_review" ? "active" : ""} onClick={() => setFilter("awaiting_review")}>
          Awaiting review
        </button>
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          All active
        </button>
      </div>

      {reports.length === 0 && <p className="center-note">Nothing here — you're on top of it.</p>}

      {reports.map((r) => (
        <button key={r.id} type="button" className="queue-row" onClick={() => navigate(`/officer/${r.id}`)}>
          <div className="thumb">{TIER_ICON[r.proposed_tier ?? ""] ?? "🌳"}</div>
          <div className="meta">
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
              <span className={`tier-badge tier-${r.proposed_tier ?? "unscored"}`}>
                {(r.proposed_tier ?? "unscored").replace(/_/g, " ")}
              </span>
              <span className="pill">conf {r.confidence != null ? Math.round(r.confidence * 100) + "%" : "—"}</span>
              {r.confirmation_count > 0 && <span className="pill">{r.confirmation_count} confirmations</span>}
            </div>
            <div className="reason">{r.reason ?? "Not yet scored"}</div>
          </div>
          <span className="pill">{r.review_state.replace(/_/g, " ")}</span>
        </button>
      ))}
    </div>
  );
}

function StatTile({ n, label, highlight }: { n: number; label: string; highlight?: boolean }) {
  return (
    <div className="stat-tile" style={highlight && n > 0 ? { borderColor: "var(--tier-utility-emergency)" } : undefined}>
      <div className="n" style={highlight && n > 0 ? { color: "var(--tier-utility-emergency)" } : undefined}>
        {n}
      </div>
      <div className="label">{label}</div>
    </div>
  );
}
