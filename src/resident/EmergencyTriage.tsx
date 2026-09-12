import { useState } from "react";

interface Props {
  onContinue: (preFlaggedUrgent: boolean) => void;
}

/**
 * PRD 6.1 / build-plan Step 6: this screen is non-negotiable and comes
 * before any photo upload. A "yes" on the power-line question routes
 * straight out — we don't try to capture that report at all.
 */
export default function EmergencyTriage({ onContinue }: Props) {
  const [powerLine, setPowerLine] = useState<boolean | null>(null);
  const [blocking, setBlocking] = useState<boolean | null>(null);
  const [alreadyFallen, setAlreadyFallen] = useState<boolean | null>(null);

  if (powerLine === true) {
    return (
      <div className="screen">
        <div className="emergency-banner">
          If anything is touching a live power line, call <strong>911</strong> right now.
          <br />
          <br />
          To report a downed line to Nova Scotia Power: <strong>1-877-428-6004</strong>.
          <br />
          <br />
          Please don't wait on this app — step back to a safe distance and make the call.
        </div>
      </div>
    );
  }

  const ready = powerLine !== null && blocking !== null && alreadyFallen !== null;

  return (
    <div className="screen">
      <p className="lede">Three quick questions before anything else.</p>

      <YesNo
        question="Is the tree or branch touching, leaning on, or near a power line?"
        value={powerLine}
        onChange={setPowerLine}
      />
      <YesNo
        question="Is it blocking a road, sidewalk, or driveway right now?"
        value={blocking}
        onChange={setBlocking}
      />
      <YesNo
        question="Has it already fallen on a building, vehicle, or person?"
        value={alreadyFallen}
        onChange={setAlreadyFallen}
      />

      <button
        type="button"
        className="btn btn-primary"
        disabled={!ready}
        onClick={() => onContinue(Boolean(blocking || alreadyFallen))}
      >
        Continue
      </button>
    </div>
  );
}

function YesNo({
  question,
  value,
  onChange
}: {
  question: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="question-block">
      <div className="q">{question}</div>
      <div className="btn-row">
        <button
          type="button"
          className={value === true ? "btn btn-danger" : "btn btn-secondary"}
          onClick={() => onChange(true)}
        >
          Yes
        </button>
        <button
          type="button"
          className={value === false ? "btn btn-primary" : "btn btn-secondary"}
          onClick={() => onChange(false)}
        >
          No
        </button>
      </div>
    </div>
  );
}
