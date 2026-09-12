import { useState } from "react";
import EmergencyTriage from "./EmergencyTriage";
import ReportForm from "./ReportForm";
import Confirmation from "./Confirmation";

type Step = "triage" | "form" | "done";

export default function ResidentHome({ onViewMap }: { onViewMap: () => void }) {
  const [step, setStep] = useState<Step>("triage");
  const [preFlaggedUrgent, setPreFlaggedUrgent] = useState(false);
  const [result, setResult] = useState<any>(null);

  if (step === "triage") {
    return (
      <EmergencyTriage
        onContinue={(urgent) => {
          setPreFlaggedUrgent(urgent);
          setStep("form");
        }}
      />
    );
  }

  if (step === "form") {
    return (
      <ReportForm
        preFlaggedUrgent={preFlaggedUrgent}
        onDone={(r) => {
          setResult(r);
          setStep("done");
        }}
      />
    );
  }

  return (
    <Confirmation
      result={result}
      onViewMap={onViewMap}
      onNewReport={() => {
        setResult(null);
        setStep("triage");
      }}
    />
  );
}
