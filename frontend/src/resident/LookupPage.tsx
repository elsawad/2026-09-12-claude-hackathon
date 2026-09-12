import { useState } from "react";
import { lookupReport } from "../lib/api";

export default function LookupPage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLookup() {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await lookupReport(code.trim().toUpperCase());
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <div className="card">
        <h2>Check a report's status</h2>
        <p className="lede">Enter the reference code you got when you submitted a report.</p>
        <div className="field">
          <label>Reference code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="CW-XXXXXX"
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          />
        </div>
        <button type="button" disabled={loading} onClick={handleLookup}>
          {loading ? "Looking up…" : "Check status"}
        </button>

        {error && <p className="error-text">{error}</p>}

        {result && (
          <dl className="kv">
            <dt>Reference code</dt>
            <dd>{result.referenceCode}</dd>
            <dt>Tier</dt>
            <dd>
              {result.tier ? (
                <span className={`tier-badge tier-${result.tier}`}>{result.tier.replace(/_/g, " ")}</span>
              ) : (
                "not yet scored"
              )}
            </dd>
            <dt>Reviewed by a human?</dt>
            <dd>{result.reviewState === "awaiting_review" ? "Not yet" : result.reviewState.replace(/_/g, " ")}</dd>
            <dt>Status</dt>
            <dd>{result.status.replace(/_/g, " ")}</dd>
            <dt>Submitted</dt>
            <dd>{new Date(result.createdAt).toLocaleString()}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
