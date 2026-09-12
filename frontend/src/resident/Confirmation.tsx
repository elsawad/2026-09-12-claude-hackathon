import { TIER_LABEL, TIER_SLA, type Tier } from "../types";

interface Props {
  result: {
    kind: "created" | "diverted_private";
    referenceCode: string;
    tier?: Tier;
    message?: string;
    possibleDuplicate?: { referenceCode: string; distanceApprox: string } | null;
  };
  onNewReport: () => void;
  onViewMap: () => void;
}

export default function Confirmation({ result, onNewReport, onViewMap }: Props) {
  const isDiverted = result.kind === "diverted_private";

  return (
    <div className="screen">
      <div className="card">
        <h2>{isDiverted ? "Thanks — here's what to do next" : "Report received"}</h2>

        <div className="reference-code">{result.referenceCode}</div>
        <p className="helper-text center">Save this code to check the status later on the "Check status" tab.</p>

        {isDiverted ? (
          <p className="lede">{result.message}</p>
        ) : (
          <>
            {result.tier && (
              <p className="center">
                <span className={`tier-badge tier-${result.tier}`}>
                  {TIER_LABEL[result.tier]} — {TIER_SLA[result.tier]}
                </span>
              </p>
            )}
            <p className="lede">
              An arborist will review this. Nothing is dispatched automatically — a human always makes the
              final call.
            </p>
            {result.possibleDuplicate && (
              <p className="notice">
                Heads up: there's already a report {result.possibleDuplicate.distanceApprox} of this spot. Yours
                has still been logged — check the map to see it.
              </p>
            )}
          </>
        )}

        <div className="stack">
          <button type="button" className="secondary" onClick={onViewMap}>
            View the live map
          </button>
          <button type="button" onClick={onNewReport}>
            Report another tree
          </button>
        </div>
      </div>
    </div>
  );
}
