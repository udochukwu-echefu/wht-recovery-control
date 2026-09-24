"use client";

import {
  CheckCircle2,
  Clock3,
  CircleAlert,
  RefreshCw,
  Download,
  ShieldCheck,
  ListFilter,
  Search,
  Activity,
  Copy,
  ChevronRight,
  X,
  ArrowUpRight,
} from "lucide-react";
import { type AppMode } from "./types";
import { useState, useCallback, useEffect, useMemo } from "react";
import { CustomSelect } from "./custom-select";

type AiActivityJob = {
  id: string;
  taskType: string;
  status: string;
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  confidence: number | null;
  latencyMs: number | null;
  validationOutcome: string;
  sourceReferences: Array<{ type: string; id: string; label: string }>;
  caseId: string | null;
  documentId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  output?: unknown;
  humanCorrection?: unknown;
};

type AiActivityStatus = "completed" | "needs_review" | "failed" | "running";

function demoAiActivityJobs(anchor = Date.now()): AiActivityJob[] {
  const timestamp = (minutesAgo: number) =>
    new Date(anchor - minutesAgo * 60_000).toISOString();
  return [
    {
      id: "demo-job-004",
      taskType: "case_copilot",
      status: "completed",
      provider: "Demo assistant",
      model: "Synthetic response",
      promptVersion: "case-copilot.v1",
      inputHash: "demo-004",
      confidence: 94,
      latencyMs: 780,
      validationOutcome: "validated",
      sourceReferences: [
        { type: "case", id: "WHT-0241", label: "Alpha Energy" },
      ],
      caseId: "WHT-0241",
      documentId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp(18),
      completedAt: timestamp(17),
      output: {
        summary: "Explained the evidence exception using synthetic case facts.",
      },
    },
    {
      id: "demo-job-003",
      taskType: "receipt_extraction",
      status: "manual_review",
      provider: "Demo assistant",
      model: "Synthetic extraction",
      promptVersion: "receipt-extraction.v2",
      inputHash: "demo-003",
      confidence: 72,
      latencyMs: 1240,
      validationOutcome: "manual_review",
      sourceReferences: [
        { type: "document", id: "DEMO-RCP-238", label: "Metro Foods receipt" },
      ],
      caseId: "WHT-0238",
      documentId: "DEMO-RCP-238",
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp(74),
      completedAt: timestamp(73),
      output: {
        summary: "Receipt fields extracted; reviewer confirmation required.",
      },
    },
    {
      id: "demo-job-002",
      taskType: "candidate_ranking",
      status: "completed",
      provider: "Demo assistant",
      model: "Synthetic ranking",
      promptVersion: "candidate-ranking.v1",
      inputHash: "demo-002",
      confidence: 88,
      latencyMs: 630,
      validationOutcome: "validated",
      sourceReferences: [
        { type: "case", id: "WHT-0234", label: "Civic Works" },
      ],
      caseId: "WHT-0234",
      documentId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp(132),
      completedAt: timestamp(131),
      output: {
        summary:
          "Candidate ordering checked against deterministic value and age rules.",
      },
    },
    {
      id: "demo-job-001",
      taskType: "exception_explanation",
      status: "completed",
      provider: "Demo assistant",
      model: "Synthetic explanation",
      promptVersion: "exception-explanation.v1",
      inputHash: "demo-001",
      confidence: 91,
      latencyMs: 910,
      validationOutcome: "validated",
      sourceReferences: [
        { type: "case", id: "WHT-0229", label: "Northstar Ltd" },
      ],
      caseId: "WHT-0229",
      documentId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp(245),
      completedAt: timestamp(244),
      output: {
        summary:
          "Partial-match exception translated into practitioner language.",
      },
    },
  ];
}

const aiTaskLabels: Record<string, string> = {
  case_copilot: "Case copilot",
  recovery_plan: "Recovery plan",
  exception_explanation: "Exception explanation",
  candidate_ranking: "Candidate ranking",
  receipt_extraction: "Receipt extraction",
  document_classification: "Document classification",
  ledger_mapping: "Ledger mapping",
  communication_draft: "Communication draft",
  evidence_summary: "Evidence summary",
  portfolio_briefing: "Portfolio briefing",
};

function aiTaskLabel(taskType: string) {
  return (
    aiTaskLabels[taskType] ??
    taskType
      .replaceAll("_", " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

function aiActivityStatus(job: AiActivityJob): AiActivityStatus {
  if (job.status === "failed" || job.validationOutcome === "rejected")
    return "failed";
  if (job.status === "processing" || job.validationOutcome === "pending")
    return "running";
  if (
    job.status === "manual_review" ||
    job.validationOutcome === "manual_review" ||
    (job.status === "completed" && job.confidence === 0)
  )
    return "needs_review";
  return "completed";
}

function AiStatusLabel({ job }: { job: AiActivityJob }) {
  const status = aiActivityStatus(job);
  const labels = {
    completed: "Completed",
    needs_review:
      job.status === "completed" && job.confidence === 0
        ? "Anomaly"
        : "Needs review",
    failed: "Failed",
    running: "Running",
  };
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "running"
        ? Clock3
        : CircleAlert;
  return (
    <span className={`ai-status ai-status-${status}`}>
      <Icon size={14} aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

function formatAiDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replace(" at ", ", ");
}

function formatLatency(value: number | null) {
  if (value === null) return "Not available";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function shortenContext(value: string) {
  if (value.length <= 22) return value;
  return `${value.slice(0, 8)}…${value.slice(-5)}`;
}

export function AiActivityView({
  mode,
  onNotify,
  onOpenCase,
}: {
  mode: AppMode;
  onNotify: (message: string) => void;
  onOpenCase: (id: string) => void;
}) {
  const [jobs, setJobs] = useState<AiActivityJob[]>(() =>
    mode === "demo" ? demoAiActivityJobs() : [],
  );
  const [loading, setLoading] = useState(mode === "live");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AiActivityJob | null>(null);
  const [range, setRange] = useState("24h");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [taskFilter, setTaskFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(20);
  const [rangeAnchor] = useState(Date.now);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "demo") {
        setJobs(demoAiActivityJobs());
        return;
      }
      const response = await fetch("/api/assistant");
      const result = (await response.json()) as {
        jobs?: AiActivityJob[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "AI activity is unavailable");
      setJobs(result.jobs ?? []);
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "AI activity is unavailable";
      setError(message);
      onNotify(message);
    } finally {
      setLoading(false);
    }
  }, [mode, onNotify]);

  useEffect(() => {
    if (mode === "demo") return;
    let active = true;
    fetch("/api/assistant")
      .then(async (response) => {
        const result = (await response.json()) as {
          jobs?: AiActivityJob[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "AI activity is unavailable");
        if (active) setJobs(result.jobs ?? []);
      })
      .catch((loadError) => {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "AI activity is unavailable";
        if (active) setError(message);
        onNotify(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, onNotify]);

  const rangedJobs = useMemo(() => {
    if (range === "all") return jobs;
    const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
    const threshold = rangeAnchor - hours * 60 * 60 * 1000;
    return jobs.filter((job) => new Date(job.createdAt).getTime() >= threshold);
  }, [jobs, range, rangeAnchor]);

  const taskTypes = useMemo(
    () =>
      Array.from(new Set(rangedJobs.map((job) => job.taskType))).sort((a, b) =>
        aiTaskLabel(a).localeCompare(aiTaskLabel(b)),
      ),
    [rangedJobs],
  );
  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = rangedJobs.filter((job) => {
      const status = aiActivityStatus(job);
      const context = job.caseId ?? job.documentId ?? "Portfolio";
      const matchesQuery =
        !normalizedQuery ||
        [
          aiTaskLabel(job.taskType),
          context,
          job.id,
          job.model,
          job.promptVersion,
          ...job.sourceReferences.flatMap((source) => [
            source.id,
            source.label,
          ]),
        ].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesTask = taskFilter === "all" || job.taskType === taskFilter;
      const matchesConfidence =
        confidenceFilter === "all" ||
        (confidenceFilter === "missing" && job.confidence === null) ||
        (confidenceFilter === "high" &&
          job.confidence !== null &&
          job.confidence >= 85) ||
        (confidenceFilter === "medium" &&
          job.confidence !== null &&
          job.confidence >= 60 &&
          job.confidence < 85) ||
        (confidenceFilter === "low" &&
          job.confidence !== null &&
          job.confidence < 60);
      return matchesQuery && matchesStatus && matchesTask && matchesConfidence;
    });
    return result.toSorted((a, b) =>
      sort === "oldest"
        ? +new Date(a.createdAt) - +new Date(b.createdAt)
        : sort === "confidence"
          ? (b.confidence ?? -1) - (a.confidence ?? -1)
          : sort === "latency"
            ? (b.latencyMs ?? -1) - (a.latencyMs ?? -1)
            : +new Date(b.createdAt) - +new Date(a.createdAt),
    );
  }, [rangedJobs, query, statusFilter, taskFilter, confidenceFilter, sort]);

  const validated = rangedJobs.filter(
    (job) => aiActivityStatus(job) === "completed",
  ).length;
  const needsReview = rangedJobs.filter(
    (job) => aiActivityStatus(job) === "needs_review",
  ).length;
  const latencyValues = rangedJobs
    .map((job) => job.latencyMs)
    .filter((value): value is number => value !== null)
    .toSorted((a, b) => a - b);
  const medianLatency = latencyValues.length
    ? latencyValues[Math.floor(latencyValues.length / 2)]
    : null;
  const validationRate = rangedJobs.length
    ? (validated / rangedJobs.length) * 100
    : 0;
  const hasFilters = Boolean(
    query ||
    statusFilter !== "all" ||
    taskFilter !== "all" ||
    confidenceFilter !== "all" ||
    sort !== "newest",
  );
  const visibleJobs = filteredJobs.slice(0, visibleLimit);

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setTaskFilter("all");
    setConfidenceFilter("all");
    setSort("newest");
    setVisibleLimit(20);
  };
  const contextFor = (job: AiActivityJob) =>
    job.caseId ??
    job.sourceReferences.find((source) => source.label)?.label ??
    job.documentId ??
    "Portfolio";
  const fullContextFor = (job: AiActivityJob) =>
    job.caseId ?? job.documentId ?? job.sourceReferences[0]?.id ?? job.id;
  const copyContext = async (job: AiActivityJob) => {
    await navigator.clipboard.writeText(fullContextFor(job));
    onNotify("Context identifier copied");
  };
  const exportLog = () => {
    const header = [
      "Task",
      "Status",
      "Context",
      "Confidence",
      "Latency ms",
      "Created",
      "Validation",
    ];
    const rows = filteredJobs.map((job) => [
      aiTaskLabel(job.taskType),
      aiActivityStatus(job),
      fullContextFor(job),
      job.confidence ?? "",
      job.latencyMs ?? "",
      job.createdAt,
      job.validationOutcome,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wht-ai-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderConfidence = (job: AiActivityJob) => {
    if (job.confidence === null)
      return <span className="confidence-missing">Not available</span>;
    const level =
      job.confidence < 60 ? "low" : job.confidence < 85 ? "medium" : "high";
    return (
      <span className={`ai-confidence ai-confidence-${level}`}>
        <span>{job.confidence}%</span>
        <span className="confidence-track" aria-hidden="true">
          <span style={{ width: `${job.confidence}%` }} />
        </span>
      </span>
    );
  };

  return (
    <>
      <section className="page-heading ai-activity-heading">
        <div>
          <h1>AI activity</h1>
          <p>
            Review automated tasks, validation outcomes, confidence, latency,
            and human-review events.
          </p>
        </div>
        <div className="ai-heading-actions">
          <CustomSelect
            value={range}
            onChange={(nextRange) => {
              setRange(nextRange);
              setVisibleLimit(20);
            }}
            ariaLabel="Activity time range"
            options={[
              { value: "24h", label: "Last 24 hours" },
              { value: "7d", label: "Last 7 days" },
              { value: "30d", label: "Last 30 days" },
              { value: "all", label: "All time" },
            ]}
          />
          <button
            className="icon-button"
            onClick={() => void loadJobs()}
            aria-label="Refresh AI activity"
            title="Refresh AI activity"
          >
            <RefreshCw className={loading ? "spin" : ""} size={17} />
          </button>
          <button
            className="secondary-button ai-export-button"
            onClick={exportLog}
            disabled={!filteredJobs.length}
          >
            <Download size={16} />
            Export log
          </button>
        </div>
      </section>

      <section
        className="ai-operational-summary"
        aria-label="AI activity summary"
      >
        <div>
          <strong>{rangedJobs.length}</strong>
          <span>Recorded tasks</span>
        </div>
        <div>
          <strong>{validated}</strong>
          <span>Validated</span>
        </div>
        <div className="review-summary">
          <CircleAlert size={17} aria-hidden="true" />
          <strong>{needsReview}</strong>
          <span>Needs review</span>
        </div>
        <div>
          <strong>{validationRate.toFixed(1)}%</strong>
          <span>Validation rate</span>
        </div>
        <div>
          <strong>{formatLatency(medianLatency)}</strong>
          <span>Median latency</span>
        </div>
      </section>
      <p className="ai-governance-note">
        <ShieldCheck size={16} aria-hidden="true" />
        AI recommendations are assistive. Amounts, matches, and consequential
        status changes remain deterministic or reviewer-controlled.
      </p>

      <section
        className="ai-activity-workspace"
        aria-labelledby="activity-log-heading"
      >
        <div className="ai-table-title">
          <div>
            <h2 id="activity-log-heading">Activity log</h2>
            <p>
              {filteredJobs.length}{" "}
              {filteredJobs.length === 1 ? "result" : "results"}
            </p>
          </div>
          <button
            className="secondary-button ai-mobile-filter-toggle"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
            aria-controls="ai-filter-toolbar"
          >
            <ListFilter size={16} />
            Filters
            {hasFilters && (
              <span className="filter-count" aria-label="Filters active" />
            )}
          </button>
        </div>
        <div
          className={`ai-filter-toolbar ${filtersOpen ? "filters-open" : ""}`}
          id="ai-filter-toolbar"
        >
          <label className="ai-search-field">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search tasks or context</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleLimit(20);
              }}
              placeholder="Search tasks or context"
            />
          </label>
          <CustomSelect
            value={statusFilter}
            onChange={(nextStatus) => {
              setStatusFilter(nextStatus);
              setVisibleLimit(20);
            }}
            ariaLabel="Filter by task status"
            options={[
              { value: "all", label: "All statuses" },
              { value: "completed", label: "Completed" },
              { value: "needs_review", label: "Needs review" },
              { value: "failed", label: "Failed" },
              { value: "running", label: "Running" },
            ]}
          />
          <CustomSelect
            value={taskFilter}
            onChange={(nextTask) => {
              setTaskFilter(nextTask);
              setVisibleLimit(20);
            }}
            ariaLabel="Filter by task type"
            options={[
              { value: "all", label: "All task types" },
              ...taskTypes.map((taskType) => ({
                value: taskType,
                label: aiTaskLabel(taskType),
              })),
            ]}
          />
          <CustomSelect
            value={confidenceFilter}
            onChange={(nextConfidence) => {
              setConfidenceFilter(nextConfidence);
              setVisibleLimit(20);
            }}
            ariaLabel="Filter by confidence"
            options={[
              { value: "all", label: "All confidence" },
              { value: "high", label: "High (85%+)" },
              { value: "medium", label: "Medium (60–84%)" },
              { value: "low", label: "Low (below 60%)" },
              { value: "missing", label: "Not available" },
            ]}
          />
          <CustomSelect
            value={sort}
            onChange={setSort}
            ariaLabel="Sort AI activity"
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "confidence", label: "Highest confidence" },
              { value: "latency", label: "Longest latency" },
            ]}
          />
          {hasFilters && (
            <button
              className="text-button ai-clear-filters"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
          <span className="ai-visible-count" aria-live="polite">
            Showing {visibleJobs.length} of {filteredJobs.length}
          </span>
        </div>

        {loading ? (
          <div className="activity-skeleton" aria-label="Loading AI activity">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : error ? (
          <div className="ai-state">
            <CircleAlert size={22} />
            <h3>Activity log unavailable</h3>
            <p>{error}</p>
            <button
              className="secondary-button"
              onClick={() => void loadJobs()}
            >
              <RefreshCw size={16} />
              Retry
            </button>
          </div>
        ) : !jobs.length ? (
          <div className="ai-state">
            <Activity size={22} />
            <h3>No AI activity yet</h3>
            <p>
              Assisted imports, extraction, plans, and drafts will appear here
              with their validation record.
            </p>
          </div>
        ) : !filteredJobs.length ? (
          <div className="ai-state">
            <Search size={22} />
            <h3>No matching activity</h3>
            <p>Change or clear the filters to view recorded tasks.</p>
            <button className="secondary-button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="ai-table-scroll">
              <table className="ai-jobs-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th className="ai-context-column">Context</th>
                    <th className="numeric-heading">Confidence</th>
                    <th className="numeric-heading ai-latency-column">
                      Latency
                    </th>
                    <th
                      aria-sort={
                        sort === "newest"
                          ? "descending"
                          : sort === "oldest"
                            ? "ascending"
                            : "none"
                      }
                    >
                      Created
                    </th>
                    <th>
                      <span className="sr-only">Row action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => (
                    <tr
                      key={job.id}
                      tabIndex={0}
                      onClick={() => setSelected(job)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(job);
                        }
                      }}
                      aria-label={`Inspect ${aiTaskLabel(job.taskType)} activity`}
                    >
                      <td className="ai-task-cell">
                        <strong>{aiTaskLabel(job.taskType)}</strong>
                        <span>{job.promptVersion}</span>
                      </td>
                      <td>
                        <AiStatusLabel job={job} />
                      </td>
                      <td className="ai-context-cell ai-context-column">
                        <span title={fullContextFor(job)}>
                          {shortenContext(contextFor(job))}
                        </span>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyContext(job);
                          }}
                          aria-label={`Copy full context identifier for ${aiTaskLabel(job.taskType)}`}
                          title={`Copy ${fullContextFor(job)}`}
                        >
                          <Copy size={14} />
                        </button>
                      </td>
                      <td className="ai-confidence-cell">
                        {renderConfidence(job)}
                      </td>
                      <td className="ai-latency-cell ai-latency-column">
                        {formatLatency(job.latencyMs)}
                      </td>
                      <td className="ai-created-cell">
                        {formatAiDate(job.createdAt)}
                      </td>
                      <td>
                        <button
                          className="row-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(job);
                          }}
                          aria-label={`Inspect ${aiTaskLabel(job.taskType)} details`}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ai-mobile-list">
              {visibleJobs.map((job) => (
                <article key={job.id}>
                  <div>
                    <strong>{aiTaskLabel(job.taskType)}</strong>
                    <span>{job.promptVersion}</span>
                  </div>
                  <AiStatusLabel job={job} />
                  <dl>
                    <div>
                      <dt>Confidence</dt>
                      <dd>
                        {job.confidence === null
                          ? "Not available"
                          : `${job.confidence}%`}
                      </dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{formatAiDate(job.createdAt)}</dd>
                    </div>
                  </dl>
                  <button
                    className="secondary-button"
                    onClick={() => setSelected(job)}
                    aria-label={`View ${aiTaskLabel(job.taskType)} activity ${job.id}`}
                  >
                    View details
                    <ChevronRight size={16} />
                  </button>
                  <button
                    className="ai-mobile-context"
                    onClick={(event) => {
                      event.stopPropagation();
                      void copyContext(job);
                    }}
                    title={fullContextFor(job)}
                  >
                    <span>{shortenContext(contextFor(job))}</span>
                    <Copy size={14} />
                    <span className="sr-only">
                      Copy full context identifier
                    </span>
                  </button>
                </article>
              ))}
            </div>
            {filteredJobs.length > visibleLimit && (
              <div className="ai-load-more">
                <button
                  className="secondary-button"
                  onClick={() => setVisibleLimit((value) => value + 20)}
                >
                  Load 20 more
                </button>
                <span>{filteredJobs.length - visibleLimit} remaining</span>
              </div>
            )}
          </>
        )}
      </section>

      {selected && (
        <aside className="ai-job-drawer" aria-labelledby="ai-job-detail-title">
          <div className="ai-drawer-header">
            <div>
              <span>Audit details</span>
              <h2 id="ai-job-detail-title">{aiTaskLabel(selected.taskType)}</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => setSelected(null)}
              aria-label="Close job details"
            >
              <X size={17} />
            </button>
          </div>
          <div className="ai-drawer-body">
            <AiStatusLabel job={selected} />
            <dl className="ai-detail-grid">
              <div>
                <dt>Workflow version</dt>
                <dd>{selected.promptVersion}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>
                  {selected.confidence === null
                    ? "Not available"
                    : `${selected.confidence}%`}
                </dd>
              </div>
              <div>
                <dt>Latency</dt>
                <dd>{formatLatency(selected.latencyMs)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatAiDate(selected.createdAt)}</dd>
              </div>
              <div>
                <dt>Validation outcome</dt>
                <dd>{selected.validationOutcome.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Reviewer requirement</dt>
                <dd>
                  {aiActivityStatus(selected) === "needs_review"
                    ? "Practitioner review required"
                    : selected.humanCorrection
                      ? "Human-reviewed"
                      : "No review recorded"}
                </dd>
              </div>
            </dl>
            <section>
              <div className="ai-detail-label">
                <h3>Context</h3>
                <button onClick={() => void copyContext(selected)}>
                  <Copy size={14} />
                  Copy
                </button>
              </div>
              <code>{fullContextFor(selected)}</code>
              {selected.caseId && (
                <button
                  className="secondary-button ai-open-case"
                  onClick={() => onOpenCase(selected.caseId!)}
                >
                  Open related case <ArrowUpRight size={15} />
                </button>
              )}
            </section>
            <section>
              <h3>Decision ownership</h3>
              <ul className="ai-ownership-list">
                <li>
                  <span className="ownership-ai">AI</span>
                  <div>
                    <strong>Generated recommendation</strong>
                    <small>
                      Model output is advisory and retained with its workflow
                      version.
                    </small>
                  </div>
                </li>
                <li>
                  <span className="ownership-rule">Rule</span>
                  <div>
                    <strong>Validation outcome</strong>
                    <small>
                      Application validation recorded:{" "}
                      {selected.validationOutcome.replaceAll("_", " ")}.
                    </small>
                  </div>
                </li>
                <li>
                  <span className="ownership-human">Human</span>
                  <div>
                    <strong>Reviewer control</strong>
                    <small>
                      {selected.humanCorrection
                        ? "A human correction is attached to this job."
                        : "No human correction is attached to this job."}
                    </small>
                  </div>
                </li>
              </ul>
            </section>
            <section>
              <h3>Source references</h3>
              {selected.sourceReferences.length ? (
                <ul className="ai-source-list">
                  {selected.sourceReferences.map((source) => (
                    <li key={`${source.type}-${source.id}`}>
                      <strong>{source.label}</strong>
                      <span>{source.type}</span>
                      <code>{source.id}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ai-detail-muted">
                  No source reference was recorded.
                </p>
              )}
            </section>
            {selected.output !== undefined && (
              <section>
                <h3>Output summary</h3>
                <pre>{JSON.stringify(selected.output, null, 2)}</pre>
              </section>
            )}
            <section>
              <h3>Audit metadata</h3>
              <dl className="ai-audit-metadata">
                <div>
                  <dt>Job ID</dt>
                  <dd>{selected.id}</dd>
                </div>
                <div>
                  <dt>Input hash</dt>
                  <dd>{selected.inputHash}</dd>
                </div>
                <div>
                  <dt>Provider record</dt>
                  <dd>
                    {selected.provider} · {selected.model}
                  </dd>
                </div>
              </dl>
            </section>
            {selected.errorMessage && (
              <div className="ai-detail-error">
                <CircleAlert size={18} />
                <div>
                  <strong>{selected.errorCode ?? "Assistant error"}</strong>
                  <p>{selected.errorMessage}</p>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
