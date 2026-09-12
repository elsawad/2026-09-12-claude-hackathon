import { useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { getOfficerPassphrase, setOfficerPassphrase, clearOfficerPassphrase } from "../lib/session";
import { officerLogin } from "../lib/api";
import OfficerSummary from "./OfficerSummary";
import OfficerReportDetail from "./OfficerReportDetail";

export default function OfficerConsole() {
  const [authed, setAuthed] = useState(() => Boolean(getOfficerPassphrase()));

  if (!authed) {
    return <OfficerLogin onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="app-shell wide">
      <div className="brand-ribbon">HALIFAX REGIONAL MUNICIPALITY — COMMUNITY PILOT PROJECT</div>
      <div className="top-bar">
        <span className="wordmark">Halifax</span>
        <span className="divider" aria-hidden />
        <h1>Canopy Watch — Officer Console</h1>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: "auto", marginLeft: "auto", padding: "6px 12px", fontSize: 13 }}
          onClick={() => {
            clearOfficerPassphrase();
            setAuthed(false);
          }}
        >
          Log out
        </button>
      </div>
      <Routes>
        <Route path="/" element={<OfficerSummary />} />
        <Route path="/:id" element={<OfficerReportDetail />} />
      </Routes>
    </div>
  );
}

function OfficerLogin({ onSuccess }: { onSuccess: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      await officerLogin(passphrase);
      setOfficerPassphrase(passphrase);
      onSuccess();
    } catch {
      setError("Incorrect passphrase.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="brand-ribbon">HALIFAX REGIONAL MUNICIPALITY — COMMUNITY PILOT PROJECT</div>
      <div className="top-bar">
        <span className="wordmark">Halifax</span>
        <span className="divider" aria-hidden />
        <h1>Canopy Watch — Officer Console</h1>
      </div>
      <div className="screen">
        <div className="card">
          <h2>Sign in</h2>
          <p className="lede">
            Demo access uses a shared passphrase — real HRM staff SSO is named future work in the PRD.
          </p>
          <div className="field">
            <label>Passphrase</label>
            <input
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="button" className="btn btn-primary" disabled={loading} onClick={handleLogin}>
            {loading ? "Checking…" : "Enter"}
          </button>
          <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => navigate("/")}>
            Back to resident app
          </button>
        </div>
      </div>
    </div>
  );
}
