"use client";

import {
  LayoutDashboard,
  FolderClock,
  Upload,
  SlidersHorizontal,
  Activity,
  X,
  HelpCircle,
  Settings2,
  ShieldCheck,
  Menu,
  ChevronRight,
  Search,
  Sun,
  Moon,
  CircleAlert,
  CheckCircle2,
} from "lucide-react";
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  ChangeEvent,
} from "react";
import {
  type View,
  type AppMode,
  type SessionInfo,
  type CaseFilter,
  type LedgerWorkflow,
  type LedgerMappingItem,
  type EvidenceWorkflow,
  type AiStatus,
  type PersistentCase,
  type ReviewOutcome,
  type LedgerValidation,
  type EvidenceSummary,
} from "./types";
import { initialCases, initialImportBatches } from "./demo-data";
import { persistentCaseToView, formatNaira } from "./presentation";
import {
  type RecoveryCaseStage,
  reviewerStageTransition,
  nextActionForRecoveryCase,
  recoveryCaseExceptionLabel,
  recoveryCaseStageLabel,
} from "@/lib/case-stage-policy";
import { AppMark, StageBadge } from "./badges";
import { CaseWorkspace } from "./case-workspace";
import { Overview } from "./overview";
import { CasesView } from "./cases-view";
import { ImportsView } from "./imports-view";
import { RulesView } from "./rules-view";
import { AiActivityView } from "./ai-activity";
import { SettingsView } from "./settings-view";

const navItems = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "cases" as const, label: "Recovery cases", icon: FolderClock },
  { id: "imports" as const, label: "Data intake", icon: Upload },
  { id: "rules" as const, label: "Rules & controls", icon: SlidersHorizontal },
  { id: "ai-activity" as const, label: "AI activity", icon: Activity },
];

export function Home() {
  const [view, setView] = useState<View>("overview");
  const [cases, setCases] = useState(initialCases);
  const [appMode, setAppMode] = useState<AppMode>("demo");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [caseQuery, setCaseQuery] = useState("");
  const [filter, setFilter] = useState<CaseFilter>("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [draftVisible, setDraftVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [ledgerWorkflow, setLedgerWorkflow] = useState<LedgerWorkflow | null>(
    null,
  );
  const [ledgerMappings, setLedgerMappings] = useState<LedgerMappingItem[]>([]);
  const [isLedgerActionRunning, setIsLedgerActionRunning] = useState(false);
  const [evidenceWorkflow, setEvidenceWorkflow] =
    useState<EvidenceWorkflow | null>(null);
  const [evidenceCaseId, setEvidenceCaseId] = useState("");
  const [evidenceReviewNote, setEvidenceReviewNote] = useState("");
  const [isEvidenceConfirming, setIsEvidenceConfirming] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({
    configured: false,
    model: "deepseek-v4-flash",
    provider: "DeepSeek",
    release: "V4 Flash 0731",
  });
  const [importBatches, setImportBatches] = useState(initialImportBatches);
  const ledgerInputRef = useRef<HTMLInputElement>(null);
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const loadPersistentData = async () => {
      if (appMode === "demo") {
        setCases(initialCases);
        setImportBatches(initialImportBatches);
        return;
      }
      try {
        const [caseResponse, healthResponse, sessionResponse] =
          await Promise.all([
            fetch("/api/cases"),
            fetch("/api/health"),
            fetch("/api/session"),
          ]);
        if (sessionResponse.ok) {
          const loadedSession = (await sessionResponse.json()) as SessionInfo;
          if (active) setSession(loadedSession);
        }
        if (healthResponse.ok) {
          const health = (await healthResponse.json()) as { ai?: AiStatus };
          if (active && health.ai) setAiStatus(health.ai);
        }
        if (!caseResponse.ok) return;
        const data = (await caseResponse.json()) as {
          cases?: PersistentCase[];
          documents?: Array<{
            name: string;
            rows: number;
            status: string;
            createdAt: string;
          }>;
        };
        if (!active) return;
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases(persisted);
        setImportBatches(
          (data.documents ?? []).map((document) => ({
            name: document.name,
            rows: document.rows,
            status: document.status.replaceAll("_", " "),
            time: new Date(document.createdAt).toLocaleString("en-NG", {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })),
        );
      } catch {
        if (active) {
          setCases([]);
          setImportBatches([]);
        }
      }
    };
    void loadPersistentData();
    return () => {
      active = false;
    };
  }, [appMode]);

  const switchMode = (mode: AppMode) => {
    setAppMode(mode);
    setSelectedId(null);
    setLedgerWorkflow(null);
    setEvidenceWorkflow(null);
    window.localStorage.setItem("wht-app-mode", mode);
  };

  const toggleTheme = () => {
    const current =
      document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("wht-theme", next);
  };

  const selectedCase = cases.find((item) => item.id === selectedId) ?? null;
  const profileName =
    appMode === "live"
      ? (session?.user.displayName ?? "Local practitioner")
      : "Adanna Okafor";
  const profileInitials = profileName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const openCases = cases.filter((item) => item.stage !== "closed");
  const openAmount = openCases.reduce((total, item) => total + item.amount, 0);
  const recognisedAmount = cases
    .filter((item) => item.stage === "recognised" || item.stage === "closed")
    .reduce((total, item) => total + item.amount, 0);
  const interventionAmount = cases
    .filter(
      (item) => item.stage === "evidence-needed" || item.stage === "in-dispute",
    )
    .reduce((total, item) => total + item.amount, 0);

  const filteredCases = useMemo(() => {
    const normalized = caseQuery.trim().toLowerCase();
    return cases.filter((item) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "open" && item.stage !== "closed") ||
        (filter === "needs-intervention" &&
          (item.stage === "evidence-needed" || item.stage === "in-dispute")) ||
        item.stage === filter;
      const matchesQuery =
        !normalized ||
        [item.id, item.customer, item.invoice, item.exception]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [caseQuery, cases, filter]);

  const globalResults = useMemo(() => {
    const normalized = globalQuery.trim().toLowerCase();
    if (!normalized) return [];
    return cases
      .filter((item) =>
        [item.id, item.customer, item.invoice, item.exception]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      )
      .slice(0, 6);
  }, [cases, globalQuery]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  }, []);

  const openCase = (id: string) => {
    setSelectedId(id);
    setDraftVisible(false);
    setMobileNavOpen(false);
    setGlobalQuery("");
    window.scrollTo(0, 0);
  };

  const showCases = (nextFilter: CaseFilter = "all") => {
    setFilter(nextFilter);
    setView("cases");
    setSelectedId(null);
    setMobileNavOpen(false);
    window.scrollTo(0, 0);
  };

  const changeCaseStage = async (
    id: string,
    stage: "recognised" | "closed",
  ) => {
    const target = cases.find((item) => item.id === id);
    if (!target) return;
    if (stage === "closed" && appMode === "live") {
      notify(
        "Live cases must be closed through a recorded utilisation outcome with supporting evidence.",
      );
      return;
    }
    let nextStage: RecoveryCaseStage;
    try {
      nextStage =
        stage === "closed"
          ? "closed"
          : reviewerStageTransition(target.stage, "recognise");
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "That case transition is not permitted.",
      );
      return;
    }
    if (appMode === "live") {
      if (!target?.sourceDocumentId) {
        notify(
          "Live cases require persisted evidence before a review decision.",
        );
        return;
      }
      try {
        const response = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseId: id,
            action: "recognise",
            note: "Recognition decision recorded from case workspace",
          }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || "Review save failed");
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "The review decision could not be saved",
        );
        return;
      }
    }
    setCases((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              stage: nextStage,
              updated: "Just now",
              nextAction:
                nextActionForRecoveryCase({
                  stage: nextStage,
                  exceptionCode: item.exception,
                }) || "No further action",
            }
          : item,
      ),
    );
    notify(
      appMode === "live"
        ? stage === "recognised"
          ? "Case marked as recognised and audited"
          : "Case closed with audit history preserved"
        : "Demo preview updated locally; no live record or audit event was created.",
    );
  };

  const applyReviewOutcome = (
    id: string,
    effectiveValues: Record<string, string>,
    outcome: ReviewOutcome,
  ) => {
    setCases((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const normalizeValue = (value: string) =>
          value.toLowerCase().replace(/[^a-z0-9]/g, "");
        const amount = Number(
          (effectiveValues.wht_amount ?? "").replaceAll(",", ""),
        );
        const amountMatches =
          Number.isFinite(amount) && Math.abs(amount - item.amount) <= 100;
        const evidenceByLabel: Record<string, string> = {
          Customer: effectiveValues.customer_name || "Not extracted",
          "Invoice reference":
            effectiveValues.invoice_reference || "Not extracted",
          "Beneficiary TIN": effectiveValues.beneficiary_tin || "Not extracted",
          "WHT amount": Number.isFinite(amount)
            ? formatNaira(amount)
            : "Not extracted",
          "Reporting period":
            effectiveValues.reporting_period || "Not extracted",
        };
        const checks = item.checks.map((check) => {
          const evidenceValue =
            evidenceByLabel[check.label] ?? check.evidenceValue;
          let result = check.result;
          if (check.label === "Beneficiary TIN")
            result = !effectiveValues.beneficiary_tin
              ? "missing"
              : normalizeValue(check.bookValue) ===
                  normalizeValue(effectiveValues.beneficiary_tin)
                ? "match"
                : "mismatch";
          if (check.label === "Invoice reference")
            result = !effectiveValues.invoice_reference
              ? "missing"
              : normalizeValue(item.invoice) ===
                  normalizeValue(effectiveValues.invoice_reference)
                ? "match"
                : "mismatch";
          if (check.label === "WHT amount")
            result = !Number.isFinite(amount)
              ? "missing"
              : amountMatches
                ? "match"
                : "mismatch";
          if (check.label === "Reporting period")
            result = !effectiveValues.reporting_period
              ? "missing"
              : normalizeValue(check.bookValue) ===
                  normalizeValue(effectiveValues.reporting_period)
                ? "match"
                : "mismatch";
          return { ...check, evidenceValue, result };
        });
        return {
          ...item,
          stage: outcome.stage,
          exception: recoveryCaseExceptionLabel(outcome.exceptionCode),
          confidence: outcome.confidence,
          updated: "Just now",
          checks,
          narrative:
            "A reviewer confirmed the effective receipt fields. Deterministic rule set 2026.07 reran and the immutable review checkpoint was recorded.",
          nextAction:
            nextActionForRecoveryCase({
              stage: outcome.stage,
              exceptionCode: outcome.exceptionCode,
              hasReceipt: true,
            }) || "No further action",
        };
      }),
    );
  };

  const processUpload = async (file: File, documentText?: string) => {
    if (appMode === "demo") {
      notify(
        "Switch to Live workspace to upload and persist evidence. Demo data is read-only.",
      );
      return;
    }
    const batch = {
      name: file.name,
      rows: file.name.toLowerCase().endsWith(".pdf") ? 1 : 0,
      status: "Processing",
      time: "Just now",
    };
    setImportBatches((current) => [batch, ...current]);
    setIsImporting(true);
    setUploadProgress(18);
    try {
      const form = new FormData();
      form.set("file", file);
      if (documentText) form.set("documentText", documentText);
      const response = await fetch("/api/intake", {
        method: "POST",
        body: form,
      });
      setUploadProgress(82);
      const result = (await response.json()) as {
        error?: string;
        document?: { rows?: number; rowCount?: number; status: string };
        importedCases?: number;
        ai?: { configured?: boolean; message?: string };
        workflow?: LedgerWorkflow | EvidenceWorkflow;
      };
      if (!response.ok) throw new Error(result.error || "Import failed");
      const rows =
        result.document?.rowCount ??
        result.document?.rows ??
        result.importedCases ??
        1;
      const status = result.document?.status.replaceAll("_", " ") ?? "Complete";
      setImportBatches((current) =>
        current.map((item, index) =>
          index === 0 ? { ...item, rows, status } : item,
        ),
      );
      if (result.ai?.configured === false)
        setAiStatus((current) => ({ ...current, configured: false }));
      if (result.workflow && "importId" in result.workflow) {
        setLedgerWorkflow(result.workflow);
        setLedgerMappings(result.workflow.mapping.mappings);
      }
      if (result.workflow && "kind" in result.workflow) {
        setEvidenceWorkflow(result.workflow);
        setEvidenceCaseId(result.workflow.candidates[0]?.caseId ?? "");
        setEvidenceReviewNote("");
      }
      notify(
        result.workflow && "importId" in result.workflow
          ? "Mapping suggested. Confirm it before any recovery cases are created."
          : result.ai?.message || `${file.name} processed and saved`,
      );
      setUploadProgress(100);
      if (result.workflow) return;
      const refresh = await fetch("/api/cases");
      if (refresh.ok) {
        const data = (await refresh.json()) as { cases?: PersistentCase[] };
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases(persisted);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      setImportBatches((current) =>
        current.map((item, index) =>
          index === 0 ? { ...item, status: "Failed" } : item,
        ),
      );
      notify(message);
    } finally {
      setIsImporting(false);
      window.setTimeout(() => setUploadProgress(0), 900);
    }
  };

  const confirmEvidenceCandidate = async () => {
    if (
      !evidenceWorkflow ||
      !evidenceCaseId ||
      evidenceReviewNote.trim().length < 8
    )
      return;
    setIsEvidenceConfirming(true);
    try {
      const response = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: evidenceWorkflow.documentId,
          caseId: evidenceCaseId,
          note: evidenceReviewNote,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        deterministic?: { exceptionCode: string };
      };
      if (!response.ok)
        throw new Error(result.error || "Evidence confirmation failed");
      setEvidenceWorkflow(null);
      const refresh = await fetch("/api/cases");
      if (refresh.ok) {
        const data = (await refresh.json()) as { cases?: PersistentCase[] };
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases(persisted);
      }
      notify(
        `Candidate confirmed. Deterministic result: ${result.deterministic?.exceptionCode?.replaceAll("_", " ") ?? "recorded"}.`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Evidence confirmation failed",
      );
    } finally {
      setIsEvidenceConfirming(false);
    }
  };

  const validateLedgerWorkflow = async () => {
    if (!ledgerWorkflow) return;
    setIsLedgerActionRunning(true);
    try {
      const response = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId: ledgerWorkflow.importId,
          action: "validate",
          mappings: ledgerMappings,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        status?: string;
        validation?: LedgerValidation;
      };
      if (!response.ok || !result.validation || !result.status)
        throw new Error(result.error || "Ledger validation failed");
      setLedgerWorkflow((current) =>
        current
          ? {
              ...current,
              status: result.status!,
              validation: result.validation,
            }
          : current,
      );
      notify(
        result.validation.valid
          ? `${result.validation.validRows} rows passed deterministic validation.`
          : "Validation found issues that must be resolved before import.",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Ledger validation failed",
      );
    } finally {
      setIsLedgerActionRunning(false);
    }
  };

  const importLedgerWorkflow = async () => {
    if (!ledgerWorkflow?.validation?.valid) return;
    setIsLedgerActionRunning(true);
    try {
      const response = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId: ledgerWorkflow.importId,
          action: "import",
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        status?: string;
        importedCases?: number;
      };
      if (!response.ok) throw new Error(result.error || "Ledger import failed");
      setLedgerWorkflow((current) =>
        current ? { ...current, status: "imported" } : current,
      );
      setImportBatches((current) =>
        current.map((item, index) =>
          index === 0
            ? {
                ...item,
                status: "Imported",
                rows: result.importedCases ?? item.rows,
              }
            : item,
        ),
      );
      const refresh = await fetch("/api/cases");
      if (refresh.ok) {
        const data = (await refresh.json()) as { cases?: PersistentCase[] };
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases(persisted);
      }
      notify(
        `${result.importedCases ?? 0} candidate cases created with immutable source links.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Ledger import failed");
    } finally {
      setIsLedgerActionRunning(false);
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await processUpload(file);
  };

  const handleReceiptText = async (text: string) => {
    const fileName = `wht-receipt-text-${new Date().toISOString().slice(0, 10)}.txt`;
    await processUpload(
      new File([text], fileName, { type: "text/plain" }),
      text,
    );
  };

  const copyDraft = async (messageOverride?: string, draftId?: string) => {
    if (!selectedCase) return;
    const message =
      messageOverride ??
      `Subject: WHT evidence required for ${selectedCase.invoice}\n\nHello ${selectedCase.customer} team,\n\nOur records show a WHT deduction of ${formatNaira(selectedCase.amount)} linked to invoice ${selectedCase.invoice}. ${selectedCase.nextAction}. Please share the supporting receipt or correction confirmation so we can complete our reconciliation.\n\nRegards,\nWHT Recovery Team`;
    if (appMode === "live" && draftId) {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve-draft",
          caseId: selectedCase.id,
          draftId,
          note: "Reviewed and approved for copying to the external communication channel",
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        notify(result.error || "Draft approval could not be recorded");
        return;
      }
    }
    await navigator.clipboard?.writeText(message);
    notify(
      appMode === "live" && draftId
        ? "Draft approval recorded and request copied"
        : appMode === "demo"
          ? "Demo request copied; no approval event was recorded"
          : "Request copied to clipboard",
    );
  };

  const downloadPack = async () => {
    if (!selectedCase) return;
    if (appMode === "live") {
      try {
        const response = await fetch("/api/audit-pack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId: selectedCase.id }),
        });
        if (!response.ok) {
          const result = (await response.json()) as { error?: string };
          throw new Error(result.error || "Audit pack could not be generated");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${selectedCase.id.toLowerCase()}-audit-pack.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        notify("Immutable audit pack downloaded");
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "Audit pack could not be generated",
        );
      }
      return;
    }
    const outstandingEvidence = selectedCase.evidence.filter(
      (item) => item.state !== "verified",
    );
    const assistedSummary: EvidenceSummary = {
      executiveSummary: selectedCase.narrative,
      exceptionNarrative: `${selectedCase.exception}. Current status: ${recoveryCaseStageLabel(selectedCase.stage)}.`,
      correspondenceSummary:
        "No external communication has been sent from this synthetic demo case.",
      resolutionHistory: `Last recorded demo movement: ${selectedCase.updated}.`,
      outstandingItemsSummary: outstandingEvidence.length
        ? outstandingEvidence
            .map((item) => `${item.label}: ${item.detail}`)
            .join("; ")
        : "No outstanding evidence is shown.",
      sourceLabels: [
        "Synthetic case record",
        "Displayed evidence chain",
        "Deterministic field comparison",
      ],
    };
    const escape = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    const assistedHtml = assistedSummary
      ? `<h2>AI-assisted evidence summary</h2><p>${escape(assistedSummary.executiveSummary)}</p><p><strong>Exception:</strong> ${escape(assistedSummary.exceptionNarrative)}</p><p><strong>Correspondence:</strong> ${escape(assistedSummary.correspondenceSummary)}</p><p><strong>Resolution history:</strong> ${escape(assistedSummary.resolutionHistory)}</p><p><strong>Outstanding:</strong> ${escape(assistedSummary.outstandingItemsSummary)}</p><small>Sources: ${escape(assistedSummary.sourceLabels.join(" · "))}</small>`
      : `<h2>Evidence summary</h2><p>${escape(selectedCase.narrative)}</p><p>AI assistance was unavailable; this section contains the current deterministic case narrative.</p>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(selectedCase.id)} evidence report</title><style>body{font:14px Inter,Arial,sans-serif;color:#172019;margin:40px}h1{font-size:26px}h2{font-size:17px;margin-top:28px}header{border-bottom:2px solid #673d65;padding-bottom:18px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.box{border:1px solid #dfe4e0;padding:12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #dfe4e0;padding:9px}.notice{margin-top:32px;padding:12px;border-left:3px solid #b17aab;background:#f5eef4}@media print{body{margin:20mm}.no-print{display:none}}</style></head><body><header><small>WHT Recovery Control · Practitioner evidence report</small><h1>${escape(selectedCase.customer)}</h1><p>${escape(selectedCase.id)} · ${escape(selectedCase.invoice)} · Generated ${new Date().toLocaleString("en-NG")}</p></header><h2>Case summary</h2><div class="meta"><div class="box"><small>Expected WHT</small><br><strong>${escape(formatNaira(selectedCase.amount))}</strong></div><div class="box"><small>Status</small><br><strong>${escape(recoveryCaseStageLabel(selectedCase.stage))}</strong></div><div class="box"><small>Exception</small><br><strong>${escape(selectedCase.exception)}</strong></div></div>${assistedHtml}<h2>Evidence chain</h2><table><thead><tr><th>Record</th><th>Reference</th><th>Position</th><th>State</th></tr></thead><tbody>${selectedCase.evidence.map((item) => `<tr><td>${escape(item.label)}</td><td>${escape(item.reference)}</td><td>${escape(item.detail)}</td><td>${escape(item.state)}</td></tr>`).join("")}</tbody></table><h2>Deterministic comparison</h2><table><thead><tr><th>Field</th><th>Books</th><th>Evidence</th><th>Result</th></tr></thead><tbody>${selectedCase.checks.map((item) => `<tr><td>${escape(item.label)}</td><td>${escape(item.bookValue)}</td><td>${escape(item.evidenceValue)}</td><td>${escape(item.result)}</td></tr>`).join("")}</tbody></table><h2>Current action</h2><p><strong>Next action:</strong> ${escape(selectedCase.nextAction)}</p><div class="notice"><strong>Practitioner validation required.</strong> This report preserves the application state at generation time. AI-assisted text does not recognise, utilise, close or write off a credit.</div></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedCase.id.toLowerCase()}-evidence-report.html`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Evidence pack downloaded");
  };

  const navigate = (nextView: View) => {
    setView(nextView);
    setSelectedId(null);
    setMobileNavOpen(false);
    window.scrollTo(0, 0);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <AppMark />
          <div>
            <strong>WHT Recovery</strong>
            <span>Control workspace</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id && !selectedCase;
            return (
              <button
                key={item.id}
                className={active ? "active" : ""}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === "cases" && (
                  <span className="nav-count">{openCases.length}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="utility-nav" aria-label="Workspace utilities">
            <button disabled title="Support centre coming soon">
              <HelpCircle size={17} />
              <span>Support</span>
              <small>Coming soon</small>
            </button>
            <button
              className={view === "settings" && !selectedCase ? "active" : ""}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={17} />
              <span>Settings</span>
            </button>
          </div>
          <div className="pilot-chip">
            <ShieldCheck size={17} />
            <div>
              <strong>Practitioner review</strong>
              <span>Human approval required</span>
            </div>
          </div>
          <button
            type="button"
            className={`profile-row ${view === "settings" && !selectedCase ? "active" : ""}`}
            onClick={() => navigate("settings")}
            aria-current={
              view === "settings" && !selectedCase ? "page" : undefined
            }
            title="Open settings"
          >
            <span className="avatar">{profileInitials}</span>
            <span className="profile-copy">
              <strong>{profileName}</strong>
              <span>
                {appMode === "live"
                  ? (session?.workspace.role.replaceAll("_", " ") ??
                    "Loading role")
                  : "Tax reviewer"}
              </span>
            </span>
            <Settings2 size={17} />
          </button>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="nav-scrim"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <div className="entity-switcher">
            <span className="entity-mark">AC</span>
            <div>
              <strong>
                {appMode === "live"
                  ? (session?.workspace.name ?? "Live workspace")
                  : "Aster Consulting Ltd"}
              </strong>
              <span>
                {appMode === "live"
                  ? `${session?.workspace.role?.replaceAll("_", " ") ?? "Loading access"} · persisted records`
                  : "Demo portfolio · synthetic records"}
              </span>
            </div>
            <ChevronRight size={16} />
          </div>
          <div className="command-wrap">
            <label className="command-field">
              <Search size={16} />
              <input
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && globalResults[0])
                    openCase(globalResults[0].id);
                  if (event.key === "Escape") setGlobalQuery("");
                }}
                placeholder="Find customer, invoice or case"
                aria-label="Find customer, invoice or case"
              />
              <kbd>⌘ K</kbd>
            </label>
            {globalQuery && (
              <div
                className="command-results"
                role="listbox"
                aria-label="Case search results"
              >
                {globalResults.length ? (
                  globalResults.map((item) => (
                    <button
                      key={item.id}
                      role="option"
                      aria-selected="false"
                      onClick={() => openCase(item.id)}
                    >
                      <span>
                        <strong>{item.customer}</strong>
                        <small>
                          {item.invoice} · {item.id}
                        </small>
                      </span>
                      <StageBadge stage={item.stage} />
                    </button>
                  ))
                ) : (
                  <p>No matching customers, invoices or cases.</p>
                )}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <div
              className="mode-switch"
              role="group"
              aria-label="Workspace data mode"
            >
              <button
                className={appMode === "demo" ? "active" : ""}
                onClick={() => switchMode("demo")}
                aria-pressed={appMode === "demo"}
              >
                Demo
              </button>
              <button
                className={appMode === "live" ? "active" : ""}
                onClick={() => switchMode("live")}
                aria-pressed={appMode === "live"}
              >
                Live
              </button>
            </div>
            <button
              className="icon-button"
              aria-label="Help centre coming soon"
              title="Help centre coming soon"
              disabled
            >
              <HelpCircle size={18} />
            </button>
            <button
              className="icon-button theme-toggle"
              onClick={toggleTheme}
              aria-label="Toggle light or dark mode"
              title="Toggle light or dark mode"
            >
              <Sun className="theme-icon-light" size={18} />
              <Moon className="theme-icon-dark" size={18} />
            </button>
            {view !== "imports" && !selectedCase && (
              <button
                className="primary-button global-import"
                onClick={() => navigate("imports")}
                aria-label="Import evidence"
                title="Open data intake"
              >
                <Upload size={18} strokeWidth={2.3} />
                <span>Import evidence</span>
              </button>
            )}
          </div>
        </header>

        {appMode === "demo" && (
          <div className="demo-mode-banner" role="status">
            <CircleAlert size={16} />
            <span>
              <strong>Demo data</strong> — synthetic records are isolated from
              the live workspace. Changes remain in this browser and do not
              create audit events.
            </span>
            <button onClick={() => switchMode("live")}>
              Open live workspace
            </button>
          </div>
        )}

        {selectedCase ? (
          <CaseWorkspace
            mode={appMode}
            recoveryCase={selectedCase}
            draftVisible={draftVisible}
            onBack={() => {
              setSelectedId(null);
              window.scrollTo(0, 0);
            }}
            onToggleDraft={() => setDraftVisible((value) => !value)}
            onCopyDraft={copyDraft}
            onDownload={downloadPack}
            onRecognise={() => changeCaseStage(selectedCase.id, "recognised")}
            onClose={() => changeCaseStage(selectedCase.id, "closed")}
            onReviewComplete={(effectiveValues, outcome) =>
              applyReviewOutcome(selectedCase.id, effectiveValues, outcome)
            }
            onNotify={notify}
            onAttachReceipt={() => navigate("imports")}
          />
        ) : (
          <div className="content-area">
            {view === "overview" && (
              <Overview
                mode={appMode}
                cases={cases}
                openAmount={openAmount}
                recognisedAmount={recognisedAmount}
                interventionAmount={interventionAmount}
                onOpenCase={openCase}
                onViewCases={() => showCases("all")}
                onFilterCases={showCases}
              />
            )}

            {view === "cases" && (
              <CasesView
                cases={filteredCases}
                query={caseQuery}
                filter={filter}
                onQueryChange={setCaseQuery}
                onFilterChange={setFilter}
                onOpenCase={openCase}
              />
            )}

            {view === "imports" && (
              <ImportsView
                batches={importBatches}
                ledgerInputRef={ledgerInputRef}
                evidenceInputRef={evidenceInputRef}
                onImport={handleImport}
                onReceiptText={handleReceiptText}
                isImporting={isImporting}
                uploadProgress={uploadProgress}
                aiStatus={aiStatus}
                ledgerWorkflow={ledgerWorkflow}
                ledgerMappings={ledgerMappings}
                onMappingChange={setLedgerMappings}
                onValidateLedger={() => void validateLedgerWorkflow()}
                onImportLedger={() => void importLedgerWorkflow()}
                isLedgerActionRunning={isLedgerActionRunning}
                evidenceWorkflow={evidenceWorkflow}
                evidenceCaseId={evidenceCaseId}
                evidenceReviewNote={evidenceReviewNote}
                onEvidenceCaseChange={setEvidenceCaseId}
                onEvidenceReviewNoteChange={setEvidenceReviewNote}
                onConfirmEvidence={() => void confirmEvidenceCandidate()}
                isEvidenceConfirming={isEvidenceConfirming}
                onNotify={notify}
                onViewCases={() => showCases("all")}
              />
            )}

            {view === "rules" && <RulesView mode={appMode} onNotify={notify} />}
            {view === "ai-activity" && (
              <AiActivityView
                key={appMode}
                mode={appMode}
                onNotify={notify}
                onOpenCase={openCase}
              />
            )}
            {view === "settings" && (
              <SettingsView
                mode={appMode}
                session={session}
                onNotify={notify}
                onSwitchLive={() => switchMode("live")}
                onToggleTheme={toggleTheme}
              />
            )}
          </div>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
