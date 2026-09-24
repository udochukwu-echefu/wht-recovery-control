"use client";

import { type AppMode, type RecoveryCase, type CaseFilter } from "./types";
import { useState } from "react";
import { formatNaira } from "./presentation";
import { FileSearch2, ChevronRight, RefreshCw, FileText } from "lucide-react";

export function PortfolioBriefingPanel({
  mode,
  cases,
  onFilterCases,
}: {
  mode: AppMode;
  cases: RecoveryCase[];
  onFilterCases: (filter: CaseFilter) => void;
}) {
  const [briefing, setBriefing] = useState<{
    narrative: string;
    statements: Array<{ text: string; filter: string; caseIds: string[] }>;
    dataQualityWarning: string;
    sourceLabels: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    const intervention = cases.filter(
      (item) => item.stage === "evidence-needed" || item.stage === "in-dispute",
    );
    const largest = intervention.toSorted((a, b) => b.amount - a.amount)[0];
    setLoading(true);
    try {
      if (mode === "demo") {
        setBriefing({
          narrative: intervention.length
            ? `${intervention.length} demo cases require intervention, led by ${largest?.customer ?? "the highest-value exception"}.`
            : "No demo cases currently require intervention.",
          statements: [
            {
              text: "Open the intervention queue",
              filter: "needs-intervention",
              caseIds: intervention.map((item) => item.id),
            },
          ],
          dataQualityWarning: `${cases.filter((item) => item.confidence < 70).length} demo cases have evidence confidence below 70%.`,
          sourceLabels: [
            "Synthetic case portfolio",
            "Deterministic demo totals",
          ],
        });
        return;
      }
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "portfolio-briefing",
          facts: {
            caseIds: cases.map((item) => item.id),
            interventionCount: intervention.length,
            interventionFormatted: formatNaira(
              intervention.reduce((sum, item) => sum + item.amount, 0),
            ),
            interventionCaseIds: intervention.map((item) => item.id),
            largestCustomer: largest?.customer ?? "No blocked case",
            largestException: largest?.exception ?? "No open exception",
            largestCaseId: largest?.id ?? "",
            dataQualityWarning: `${cases.filter((item) => item.confidence < 70).length} cases have evidence confidence below 70%.`,
          },
        }),
      });
      const result = (await response.json()) as { output?: typeof briefing };
      if (response.ok && result.output) setBriefing(result.output);
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="portfolio-briefing">
      <div>
        <FileSearch2 size={18} />
        <span>
          <strong>Portfolio briefing</strong>
          <small>
            {briefing
              ? briefing.narrative
              : "Generate a source-labelled summary from current deterministic portfolio totals."}
          </small>
        </span>
      </div>
      {briefing ? (
        <>
          <button
            className="text-button"
            onClick={() => onFilterCases("needs-intervention")}
          >
            Open intervention cases <ChevronRight size={15} />
          </button>
          <small className="briefing-warning">
            {briefing.dataQualityWarning}
          </small>
        </>
      ) : (
        <button
          className="secondary-button"
          onClick={() => void generate()}
          disabled={loading}
        >
          {loading ? (
            <RefreshCw className="spin" size={16} />
          ) : (
            <FileText size={16} />
          )}
          Generate briefing
        </button>
      )}
    </section>
  );
}
