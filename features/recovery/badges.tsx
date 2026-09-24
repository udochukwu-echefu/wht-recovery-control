"use client";

import { type CaseStage } from "./types";
import { recoveryCaseStageLabel } from "@/lib/case-stage-policy";

export function StageBadge({ stage }: { stage: CaseStage }) {
  return (
    <span className={`stage-badge stage-${stage}`}>
      {recoveryCaseStageLabel(stage)}
    </span>
  );
}

export function AppMark() {
  return (
    <div className="app-mark" aria-hidden="true">
      <span>W</span>
    </div>
  );
}
