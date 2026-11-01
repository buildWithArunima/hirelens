// src/components/LoadingState.jsx
import { useEffect, useState } from "react";

const STEPS = [
  "Fetching the repo from GitHub...",
  "Reading the code and the rubric...",
  "Scoring each rubric item and checking the evidence...",
  "Writing the interview guide: backend, frontend, problem solving...",
];

export function LoadingState() {
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setStep(Math.min(Math.floor(seconds / 12), STEPS.length - 1)), [seconds]);

  return (
    <div className="border rounded-lg p-5 bg-white mb-6 flex items-center gap-3">
      <div className="h-5 w-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
      <div>
        <p className="font-medium">{STEPS[step]}</p>
        <p className="text-sm text-gray-500">{seconds}s. This usually takes two to four minutes.</p>
      </div>
    </div>
  );
}
