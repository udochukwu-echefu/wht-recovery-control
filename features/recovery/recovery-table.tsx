"use client";

import { type RecoveryCase } from "./types";
import { formatNaira, formatDays } from "./presentation";
import { StageBadge } from "./badges";
import { ChevronRight } from "lucide-react";

export function RecoveryTable({
  cases,
  onOpenCase,
  compact = false,
}: {
  cases: RecoveryCase[];
  onOpenCase: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="recovery-table">
        <thead>
          <tr>
            <th>Customer / reference</th>
            <th>Expected WHT</th>
            <th>Status</th>
            {!compact && <th>Exception</th>}
            <th>Age</th>
            <th>Owner</th>
            <th>
              <span className="sr-only">Open case</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => (
            <tr
              key={item.id}
              onClick={() => onOpenCase(item.id)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  onOpenCase(item.id);
              }}
            >
              <td data-label="Case">
                <strong>{item.customer}</strong>
                <span>
                  {item.invoice} · {item.id}
                </span>
              </td>
              <td data-label="Expected WHT" className="numeric">
                <strong>{formatNaira(item.amount)}</strong>
                <span>
                  {item.confidence > 0
                    ? `${item.confidence}% evidence confidence`
                    : "Confidence not assessed"}
                </span>
              </td>
              <td data-label="Status">
                <StageBadge stage={item.stage} />
              </td>
              {!compact && (
                <td data-label="Exception">
                  <span className="exception-copy">{item.exception}</span>
                </td>
              )}
              <td data-label="Age">
                <strong>{item.age ? formatDays(item.age) : "—"}</strong>
              </td>
              <td data-label="Owner">
                <span
                  className={
                    item.owner === "Unassigned" ? "owner unassigned" : "owner"
                  }
                >
                  {item.owner}
                </span>
              </td>
              <td>
                <button
                  className="row-button"
                  aria-label={`Open ${item.customer} case`}
                >
                  <ChevronRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
