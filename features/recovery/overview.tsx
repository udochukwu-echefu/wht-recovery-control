"use client";

import {
  type AppMode,
  type RecoveryCase,
  type CaseFilter,
  type CaseStage,
} from "./types";
import {
  Clock3,
  ChevronRight,
  ArrowUpRight,
  BadgeCheck,
  CircleAlert,
  Mail,
} from "lucide-react";
import { formatNaira, formatDays } from "./presentation";
import { PortfolioBriefingPanel } from "./portfolio-briefing";
import { OverviewAssistant } from "./overview-assistant";
import { RecoveryTable } from "./recovery-table";

export function Overview({
  mode,
  cases,
  openAmount,
  recognisedAmount,
  interventionAmount,
  profileName,
  sessionScope,
  onOpenCase,
  onViewCases,
  onFilterCases,
}: {
  mode: AppMode;
  cases: RecoveryCase[];
  openAmount: number;
  recognisedAmount: number;
  interventionAmount: number;
  profileName: string;
  sessionScope: string;
  onOpenCase: (id: string) => void;
  onViewCases: () => void;
  onFilterCases: (filter: CaseFilter) => void;
}) {
  const priorityCases = cases
    .filter((item) => item.stage !== "closed")
    .toSorted(
      (a, b) => b.amount * Math.max(b.age, 1) - a.amount * Math.max(a.age, 1),
    )
    .slice(0, 4);
  const activeCases = cases.filter((item) => item.stage !== "closed");
  const ages = activeCases.map((item) => item.age).toSorted((a, b) => a - b);
  const medianAge = ages.length ? ages[Math.floor(ages.length / 2)] : 0;
  const oldestAge = ages.at(-1) ?? 0;
  const coverageGroups = [
    {
      label: "Covered",
      stages: ["detected", "matched"] as CaseStage[],
      tone: "info",
    },
    {
      label: "Evidence missing",
      stages: ["evidence-needed"] as CaseStage[],
      tone: "warning",
    },
    {
      label: "Disputed",
      stages: ["in-dispute"] as CaseStage[],
      tone: "danger",
    },
    {
      label: "Recognised",
      stages: ["recognised", "closed"] as CaseStage[],
      tone: "success",
    },
  ].map((group) => ({
    ...group,
    value: cases
      .filter((item) => group.stages.includes(item.stage))
      .reduce((total, item) => total + item.amount, 0),
    count: cases.filter((item) => group.stages.includes(item.stage)).length,
  }));
  const coverageTotal =
    coverageGroups.reduce((total, group) => total + group.value, 0) || 1;

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Recovery overview</h1>
          <p>Cases requiring evidence, correction or reviewer action.</p>
        </div>
        <div className="as-of">
          <Clock3 size={16} />
          Data refreshed 8 minutes ago
        </div>
      </section>

      <section className="portfolio-summary" aria-label="Portfolio summary">
        <button
          className="intervention-summary"
          onClick={() => onFilterCases("needs-intervention")}
        >
          <span>Needs intervention</span>
          <strong>{formatNaira(interventionAmount)}</strong>
          <small>
            {
              cases.filter(
                (item) =>
                  item.stage === "evidence-needed" ||
                  item.stage === "in-dispute",
              ).length
            }{" "}
            cases with missing or disputed evidence
          </small>
          <ChevronRight size={18} />
        </button>
        <div className="supporting-metrics">
          <button onClick={() => onFilterCases("open")}>
            <span>Open value</span>
            <strong>{formatNaira(openAmount)}</strong>
            <small>{activeCases.length} active cases</small>
          </button>
          <button onClick={() => onFilterCases("recognised")}>
            <span>Recognised value</span>
            <strong>{formatNaira(recognisedAmount)}</strong>
            <small>Ready for utilisation or closed</small>
          </button>
          <button onClick={() => onFilterCases("open")}>
            <span>Median open age</span>
            <strong>{formatDays(medianAge)}</strong>
            <small>Oldest case: {formatDays(oldestAge)}</small>
          </button>
        </div>
      </section>

      <PortfolioBriefingPanel
        mode={mode}
        cases={cases}
        onFilterCases={onFilterCases}
      />

      <OverviewAssistant
        key={`${mode}:${sessionScope}`}
        mode={mode}
        profileName={profileName}
        cases={cases}
        onOpenCase={onOpenCase}
        onViewCases={onViewCases}
        onFilterCases={onFilterCases}
      />

      <div className="overview-grid">
        <section className="work-panel priority-panel">
          <div className="section-heading">
            <div>
              <h2>Priority recovery queue</h2>
              <p>Ranked by value and age.</p>
            </div>
            <button className="text-button" onClick={onViewCases}>
              View all cases <ArrowUpRight size={16} />
            </button>
          </div>
          <RecoveryTable
            cases={priorityCases}
            onOpenCase={onOpenCase}
            compact
          />
        </section>

        <div className="overview-side-column">
          <aside className="portfolio-panel">
            <div className="section-heading">
              <div>
                <h2>Evidence coverage</h2>
                <p>Value by current control position.</p>
              </div>
            </div>
            <div className="coverage-breakdown">
              {coverageGroups.map((group) => (
                <button
                  key={group.label}
                  onClick={() =>
                    onFilterCases(
                      group.label === "Evidence missing"
                        ? "evidence-needed"
                        : group.label === "Disputed"
                          ? "in-dispute"
                          : group.label === "Recognised"
                            ? "recognised"
                            : "open",
                    )
                  }
                >
                  <span className="coverage-label">
                    <i className={group.tone} />
                    {group.label}
                    <small>
                      {group.count} {group.count === 1 ? "case" : "cases"}
                    </small>
                  </span>
                  <strong>{formatNaira(group.value)}</strong>
                  <span className="coverage-progress" aria-hidden="true">
                    <span
                      className={group.tone}
                      style={{ width: `${(group.value / coverageTotal) * 100}%` }}
                    />
                  </span>
                </button>
              ))}
            </div>
          </aside>
          <section className="activity-band">
            <div className="section-heading">
              <div>
                <h2>Recent case activity</h2>
              </div>
            </div>
            <div className="activity-list">
              <div>
                <span className="activity-icon success">
                  <BadgeCheck size={17} />
                </span>
                <p>
                  <strong>Civic Works</strong> credit matched to authority record{" "}
                  <span>29 Jul · AO</span>
                </p>
              </div>
              <div>
                <span className="activity-icon warning">
                  <CircleAlert size={17} />
                </span>
                <p>
                  <strong>Alpha Energy</strong> moved to dispute after TIN
                  validation <span>Today · System</span>
                </p>
              </div>
              <div>
                <span className="activity-icon neutral">
                  <Mail size={17} />
                </span>
                <p>
                  <strong>Metro Foods</strong> receipt request drafted for approval{" "}
                  <span>Yesterday · AA</span>
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
