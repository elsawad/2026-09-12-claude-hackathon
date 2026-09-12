import { Link } from "react-router-dom";

const TIER_LABELS: Record<string, string> = {
  utility_emergency: "Utility emergency",
  imminent_hazard: "Imminent hazard — HRM's 24-48hr priority",
  routine: "Routine — HRM's standard maintenance queue",
  insufficient_info: "Needs a bit more information"
};

export default function Confirmation({ result, onNewReport }: { result: any; onNewReport: () => void }) {
  const isDiverted = result.kind === "diverted_private";

  return (
    <div className="screen">
      <div className="card">
        <h2>{isDiverted ? "Thanks — here's what to do next" : "Report received"}</h2>

        <div className="reference-code">{result.referenceCode}</div>
        <p className="helper-text" style={{ textAlign: "center" }}>
          Save this code to check the status later on the "Check status" tab.
        </p>

        {isDiverted ? (
          <p className="lede">{result.message}</p>
        ) : (
          <>
            {result.tier && <p style={{ textAlign: "center" }}><span className={`tier-badge tier-${result.tier}`}>{TIER_LABELS[result.tier]}</span></p>}
            <p className="lede">
              An arborist will review this. Nothing is dispatched automatically — a human always
              makes the final call.
            </p>
            {result.possibleDuplicate && (
              <p className="notice">
                Heads up: there's already a report {result.possibleDuplicate.distanceApprox} of this
                spot. Yours has still been logged — check the map to see it.
              </p>
            )}
          </>
        )}

        <div className="stack" style={{ marginTop: 16 }}>
          <Link to="/map">
            <button type="button" className="btn btn-secondary" style={{ width: "100%" }}>
              View the live map
            </button>
          </Link>
          <button type="button" className="btn btn-primary" onClick={onNewReport}>
            Report another tree
          </button>
        </div>
      </div>
    </div>
  );
}
