"use client";

import { type RecoveryCase, type CaseFilter } from "./types";
import { Search, ListFilter, FileSearch2 } from "lucide-react";
import { CustomSelect } from "./custom-select";
import {
  recoveryCaseStages,
  recoveryCaseStageLabel,
} from "@/lib/case-stage-policy";
import { RecoveryTable } from "./recovery-table";

export function CasesView({
  cases,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onOpenCase,
}: {
  cases: RecoveryCase[];
  query: string;
  filter: CaseFilter;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: CaseFilter) => void;
  onOpenCase: (id: string) => void;
}) {
  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <h1>Recovery cases</h1>
          <p>
            Review suspected deductions, evidence gaps and accountable next
            actions.
          </p>
        </div>
      </section>

      <section className="work-panel case-list-panel">
        <div className="case-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Filter this recovery list"
              aria-label="Filter the current recovery list"
            />
          </label>
          <div className="filter-field">
            <ListFilter size={17} />
            <CustomSelect
              value={filter}
              onChange={onFilterChange}
              ariaLabel="Filter recovery cases by status"
              className="filter-select"
              options={[
                { value: "all", label: "All statuses" },
                { value: "open", label: "All open cases" },
                { value: "needs-intervention", label: "Needs intervention" },
                ...recoveryCaseStages.map((value) => ({
                  value,
                  label: recoveryCaseStageLabel(value),
                })),
              ]}
            />
          </div>
        </div>
        <RecoveryTable cases={cases} onOpenCase={onOpenCase} />
        {cases.length === 0 && (
          <div className="empty-state">
            <FileSearch2 size={28} />
            <h3>No matching cases</h3>
            <p>Clear the search or change the status filter.</p>
          </div>
        )}
      </section>
    </>
  );
}
