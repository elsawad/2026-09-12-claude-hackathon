import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getOfficerReportDetail, reviewReport } from "../lib/api";

const TIER_OPTIONS = ["utility_emergency", "imminent_hazard", "routine", "insufficient_info"];

export default function OfficerReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<any>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [overrideTier, setOverrideTier] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    const data = await getOfficerReportDetail(id);
    setReport(data.report);
    setAuditLog(data.auditLog);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!id) return;
    setBusy(true);
    try {
      await reviewReport(id, { action, reviewedBy: "officer_demo", ...extra });
      await load();
      setShowOverride(false);
    } finally {
      setBusy(false);
    }
  }

  if (!report) return <div className="screen center-note">Loading…</div>;

  return (
    <div className="screen">
      <button type="button" className="btn btn-secondary" style={{ width: "auto", marginBottom: 16 }} onClick={() => navigate("/officer")}>
        ← Back to queue
      </button>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span className={`tier-badge tier-${report.final_tier ?? report.proposed_tier ?? "unscored"}`}>
            {(report.final_tier ?? report.proposed_tier ?? "unscored").replace(/_/g, " ")}
          </span>
          <span className="pill">{report.review_state.replace(/_/g, " ")}</span>
        </div>

        {report.photo_url && (
          <img src={report.photo_url} alt="Reported hazard" style={{ width: "100%", borderRadius: 10, marginBottom: 12 }} />
        )}

        <h2 style={{ fontSize: "1rem" }}>Model's reasoning</h2>
        <p className="lede">{report.reason ?? "Not yet scored."}</p>
        {report.missing_detail && <p className="notice">Missing: {report.missing_detail}</p>}

        <h2 style={{ fontSize: "1rem", marginTop: 18 }}>Original description</h2>
        <p className="lede">{report.description_original || "(none provided)"}</p>
        {report.translation_is_ai && (
          <>
            <p className="notice">Translated from {report.description_language} by AI — may not be fully accurate.</p>
            <p className="lede">{report.description_translated}</p>
          </>
        )}

        <table className="kv-table" style={{ marginTop: 16 }}>
          <tbody>
            <tr>
              <td>Location</td>
              <td>{report.lat.toFixed(5)}, {report.lng.toFixed(5)} ({report.location_source})</td>
            </tr>
            <tr>
              <td>Land status</td>
              <td>{report.land_status.replace(/_/g, " ")} <span className="pill">{report.land_status_source.replace(/_/g, " ")}</span></td>
            </tr>
            <tr>
              <td>Questionnaire — location</td>
              <td>{report.questionnaire_location_answer ?? "not answered"}</td>
            </tr>
            <tr>
              <td>Questionnaire — danger</td>
              <td>{report.questionnaire_danger_answer ?? "not answered"}</td>
            </tr>
            <tr>
              <td>Utility proximity</td>
              <td>
                {report.utility_proximity_m != null
                  ? `${Math.round(report.utility_proximity_m)}m — ${report.utility_feature_type ?? "unspecified feature"}`
                  : "none nearby"}
              </td>
            </tr>
            <tr>
              <td>Wind at submission</td>
              <td>{report.wind_context ?? "unavailable"}</td>
            </tr>
            <tr>
              <td>EAB regulated area</td>
              <td>{report.eab_flag ? "yes" : "no"}</td>
            </tr>
            <tr>
              <td>Historical pattern</td>
              <td>{report.historical_pattern_note ?? "no prior reports/work orders found nearby"}</td>
            </tr>
            <tr>
              <td>Model confidence</td>
              <td>{report.confidence != null ? `${Math.round(report.confidence * 100)}%` : "—"}</td>
            </tr>
            <tr>
              <td>Confirmations</td>
              <td>{report.confirmation_count}</td>
            </tr>
            <tr>
              <td>Reference code</td>
              <td>{report.reference_code}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem" }}>Actions</h2>
        {!showOverride ? (
          <div className="stack">
            <div className="btn-row">
              <button className="btn btn-primary" disabled={busy} onClick={() => act("accept")}>Accept tier</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setShowOverride(true)}>Override</button>
            </div>
            <div className="btn-row">
              <button className="btn btn-secondary" disabled={busy} onClick={() => act("escalate")}>Escalate</button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => act("in_progress")}>In progress</button>
            </div>
            <button className="btn btn-secondary" disabled={busy} onClick={() => act("resolve")}>Mark resolved</button>
          </div>
        ) : (
          <div className="stack">
            <div className="field">
              <label>New tier</label>
              <select value={overrideTier} onChange={(e) => setOverrideTier(e.target.value)}>
                <option value="">Select one</option>
                {TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Reason (required)</label>
              <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
            </div>
            <div className="btn-row">
              <button className="btn btn-secondary" onClick={() => setShowOverride(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || !overrideTier || !overrideReason.trim()}
                onClick={() => act("override", { finalTier: overrideTier, overrideReason })}
              >
                Confirm override
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem" }}>Audit log</h2>
        {auditLog.length === 0 ? (
          <p className="helper-text">Nothing logged yet.</p>
        ) : (
          <table className="kv-table">
            <tbody>
              {auditLog.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.timestamp).toLocaleString()}</td>
                  <td>
                    <strong>{entry.actor}</strong> — {entry.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
