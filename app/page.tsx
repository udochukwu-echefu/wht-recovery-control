"use client";

import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  FileSearch2,
  FileText,
  FolderClock,
  Gauge,
  LayoutDashboard,
  ListFilter,
  Mail,
  Menu,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type CaseStage =
  | "detected"
  | "evidence-needed"
  | "matched"
  | "in-dispute"
  | "recognised"
  | "closed";

type EvidenceState = "verified" | "warning" | "missing" | "pending";

type EvidenceItem = {
  label: string;
  reference: string;
  detail: string;
  state: EvidenceState;
};

type MatchCheck = {
  label: string;
  bookValue: string;
  evidenceValue: string;
  result: "match" | "mismatch" | "missing";
};

type RecoveryCase = {
  id: string;
  customer: string;
  invoice: string;
  amount: number;
  stage: CaseStage;
  exception: string;
  age: number;
  owner: string;
  confidence: number;
  updated: string;
  nextAction: string;
  narrative: string;
  evidence: EvidenceItem[];
  checks: MatchCheck[];
};

type View = "overview" | "cases" | "imports" | "rules";

type AiStatus = { configured: boolean; model: string; provider?: string; release?: string };

type PersistentCase = {
  id: string;
  customer: string;
  customerTin: string;
  invoiceReference: string;
  invoiceGrossKobo: number;
  paymentNetKobo: number;
  expectedWhtKobo: number;
  reportingPeriod: string;
  receiptNumber: string | null;
  receiptAmountKobo: number | null;
  receiptBeneficiaryTin: string | null;
  stage: string;
  exceptionCode: string;
  confidence: number;
  updatedAt: string;
};

const stageLabels: Record<CaseStage, string> = {
  detected: "Detected",
  "evidence-needed": "Evidence needed",
  matched: "Partial match",
  "in-dispute": "In dispute",
  recognised: "Recognised",
  closed: "Closed",
};

const initialCases: RecoveryCase[] = [
  {
    id: "WHT-0241",
    customer: "Alpha Energy",
    invoice: "INV-1042",
    amount: 750000,
    stage: "in-dispute",
    exception: "TIN mismatch",
    age: 134,
    owner: "AO",
    confidence: 86,
    updated: "Today, 09:42",
    nextAction: "Request amended receipt and filing confirmation",
    narrative:
      "The invoice, payment gap and receipt amount agree. The beneficiary TIN on the receipt differs from the approved company master record.",
    evidence: [
      { label: "Invoice", reference: "INV-1042", detail: "NGN 15,000,000", state: "verified" },
      { label: "Payment", reference: "PAY-8827", detail: "NGN 14,250,000", state: "verified" },
      { label: "WHT receipt", reference: "RCP-22814", detail: "Wrong beneficiary TIN", state: "warning" },
      { label: "Authority record", reference: "Not found", detail: "Awaiting correction", state: "missing" },
    ],
    checks: [
      { label: "Customer", bookValue: "Alpha Energy Ltd", evidenceValue: "Alpha Energy Limited", result: "match" },
      { label: "Beneficiary TIN", bookValue: "01234567-0001", evidenceValue: "01234576-0001", result: "mismatch" },
      { label: "WHT amount", bookValue: "NGN 750,000", evidenceValue: "NGN 750,000", result: "match" },
      { label: "Reporting period", bookValue: "Mar 2026", evidenceValue: "Mar 2026", result: "match" },
    ],
  },
  {
    id: "WHT-0238",
    customer: "Metro Foods",
    invoice: "INV-1077",
    amount: 185000,
    stage: "evidence-needed",
    exception: "Receipt missing",
    age: 71,
    owner: "AA",
    confidence: 72,
    updated: "Yesterday, 16:18",
    nextAction: "Request deduction receipt from accounts payable",
    narrative:
      "The payment gap is consistent with the expected deduction, but no receipt or remittance advice is attached to the transaction.",
    evidence: [
      { label: "Invoice", reference: "INV-1077", detail: "NGN 3,700,000", state: "verified" },
      { label: "Payment", reference: "PAY-8792", detail: "NGN 3,515,000", state: "verified" },
      { label: "WHT receipt", reference: "Missing", detail: "Request required", state: "missing" },
      { label: "Authority record", reference: "Not checked", detail: "Blocked by missing evidence", state: "pending" },
    ],
    checks: [
      { label: "Customer", bookValue: "Metro Foods Plc", evidenceValue: "Metro Foods Plc", result: "match" },
      { label: "Payment gap", bookValue: "NGN 185,000", evidenceValue: "NGN 185,000", result: "match" },
      { label: "WHT receipt", bookValue: "Expected", evidenceValue: "Not provided", result: "missing" },
      { label: "Reporting period", bookValue: "Apr 2026", evidenceValue: "Unknown", result: "missing" },
    ],
  },
  {
    id: "WHT-0234",
    customer: "Civic Works",
    invoice: "INV-1099",
    amount: 420000,
    stage: "recognised",
    exception: "No open exception",
    age: 18,
    owner: "AO",
    confidence: 100,
    updated: "29 Jul, 11:05",
    nextAction: "Confirm utilisation against the next eligible liability",
    narrative:
      "The invoice, payment, receipt and authority record agree. The credit is recognised and ready for utilisation review.",
    evidence: [
      { label: "Invoice", reference: "INV-1099", detail: "NGN 8,400,000", state: "verified" },
      { label: "Payment", reference: "PAY-8739", detail: "NGN 7,980,000", state: "verified" },
      { label: "WHT receipt", reference: "RCP-22409", detail: "All required fields present", state: "verified" },
      { label: "Authority record", reference: "CR-90218", detail: "Credit recognised", state: "verified" },
    ],
    checks: [
      { label: "Customer", bookValue: "Civic Works Ltd", evidenceValue: "Civic Works Ltd", result: "match" },
      { label: "Beneficiary TIN", bookValue: "08173492-0001", evidenceValue: "08173492-0001", result: "match" },
      { label: "WHT amount", bookValue: "NGN 420,000", evidenceValue: "NGN 420,000", result: "match" },
      { label: "Reporting period", bookValue: "May 2026", evidenceValue: "May 2026", result: "match" },
    ],
  },
  {
    id: "WHT-0229",
    customer: "Northstar Ltd",
    invoice: "INV-1113",
    amount: 90000,
    stage: "matched",
    exception: "Amount differs",
    age: 42,
    owner: "TM",
    confidence: 64,
    updated: "28 Jul, 14:32",
    nextAction: "Review the VAT and WHT calculation basis",
    narrative:
      "The documents refer to the same transaction, but the receipt amount is NGN 7,500 below the payment-gap candidate.",
    evidence: [
      { label: "Invoice", reference: "INV-1113", detail: "NGN 1,800,000", state: "verified" },
      { label: "Payment", reference: "PAY-8690", detail: "NGN 1,710,000", state: "verified" },
      { label: "WHT receipt", reference: "RCP-22097", detail: "NGN 82,500", state: "warning" },
      { label: "Authority record", reference: "CR-89871", detail: "NGN 82,500", state: "warning" },
    ],
    checks: [
      { label: "Customer", bookValue: "Northstar Ltd", evidenceValue: "Northstar Limited", result: "match" },
      { label: "Beneficiary TIN", bookValue: "02941763-0001", evidenceValue: "02941763-0001", result: "match" },
      { label: "WHT amount", bookValue: "NGN 90,000", evidenceValue: "NGN 82,500", result: "mismatch" },
      { label: "Reporting period", bookValue: "May 2026", evidenceValue: "May 2026", result: "match" },
    ],
  },
  {
    id: "WHT-0225",
    customer: "Horizon Logistics",
    invoice: "INV-1120",
    amount: 310000,
    stage: "detected",
    exception: "Unexplained short payment",
    age: 9,
    owner: "Unassigned",
    confidence: 58,
    updated: "27 Jul, 08:16",
    nextAction: "Confirm transaction classification and deduction basis",
    narrative:
      "A material payment gap was detected. The system needs reviewer confirmation before treating it as a WHT receivable.",
    evidence: [
      { label: "Invoice", reference: "INV-1120", detail: "NGN 6,200,000", state: "verified" },
      { label: "Payment", reference: "PAY-8644", detail: "NGN 5,890,000", state: "verified" },
      { label: "WHT receipt", reference: "Not assessed", detail: "Classification pending", state: "pending" },
      { label: "Authority record", reference: "Not assessed", detail: "Classification pending", state: "pending" },
    ],
    checks: [
      { label: "Customer", bookValue: "Horizon Logistics", evidenceValue: "Horizon Logistics", result: "match" },
      { label: "Payment gap", bookValue: "NGN 310,000", evidenceValue: "NGN 310,000", result: "match" },
      { label: "WHT applicability", bookValue: "Unconfirmed", evidenceValue: "No receipt", result: "missing" },
      { label: "Reporting period", bookValue: "Jun 2026", evidenceValue: "Unknown", result: "missing" },
    ],
  },
  {
    id: "WHT-0217",
    customer: "Delta Projects",
    invoice: "INV-1018",
    amount: 265000,
    stage: "closed",
    exception: "Utilised",
    age: 0,
    owner: "TM",
    confidence: 100,
    updated: "22 Jul, 10:01",
    nextAction: "No further action",
    narrative:
      "The recognised credit was applied and the case was closed with complete supporting evidence.",
    evidence: [
      { label: "Invoice", reference: "INV-1018", detail: "Verified", state: "verified" },
      { label: "Payment", reference: "PAY-8421", detail: "Verified", state: "verified" },
      { label: "WHT receipt", reference: "RCP-21612", detail: "Verified", state: "verified" },
      { label: "Authority record", reference: "CR-88107", detail: "Utilised", state: "verified" },
    ],
    checks: [
      { label: "Customer", bookValue: "Delta Projects Ltd", evidenceValue: "Delta Projects Ltd", result: "match" },
      { label: "Beneficiary TIN", bookValue: "04491827-0001", evidenceValue: "04491827-0001", result: "match" },
      { label: "WHT amount", bookValue: "NGN 265,000", evidenceValue: "NGN 265,000", result: "match" },
      { label: "Utilisation", bookValue: "Expected", evidenceValue: "Confirmed", result: "match" },
    ],
  },
];

const navItems = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "cases" as const, label: "Recovery cases", icon: FolderClock },
  { id: "imports" as const, label: "Data intake", icon: Upload },
  { id: "rules" as const, label: "Rules & controls", icon: SlidersHorizontal },
];

const formatNaira = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace("NGN", "₦");

const exceptionLabels: Record<string, string> = {
  RECEIPT_MISSING: "Receipt missing",
  RECEIPT_FIELDS_MISSING: "Receipt fields missing",
  TIN_MISMATCH: "TIN mismatch",
  AMOUNT_MISMATCH: "Amount differs",
  PERIOD_MISMATCH: "Reporting period differs",
  NO_OPEN_EXCEPTION: "No open exception",
};

function persistentCaseToView(item: PersistentCase): RecoveryCase {
  const stage = Object.hasOwn(stageLabels, item.stage) ? item.stage as CaseStage : "detected";
  const amount = item.expectedWhtKobo / 100;
  const receiptAmount = item.receiptAmountKobo === null ? null : item.receiptAmountKobo / 100;
  const amountMatches = receiptAmount !== null && Math.abs(receiptAmount - amount) <= 100;
  const tinMatches = Boolean(item.customerTin && item.receiptBeneficiaryTin && item.customerTin.replace(/\W/g, "") === item.receiptBeneficiaryTin.replace(/\W/g, ""));
  return {
    id: item.id,
    customer: item.customer,
    invoice: item.invoiceReference,
    amount,
    stage,
    exception: exceptionLabels[item.exceptionCode] ?? item.exceptionCode.replaceAll("_", " ").toLowerCase(),
    age: Math.max(0, Math.floor((Date.now() - new Date(item.updatedAt).getTime()) / 86_400_000)),
    owner: "Unassigned",
    confidence: item.confidence,
    updated: new Date(item.updatedAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }),
    nextAction: stage === "matched" ? "Review the extracted fields and approve recognition" : stage === "in-dispute" ? "Request a corrected receipt from the deducting customer" : "Attach a WHT receipt to complete the evidence chain",
    narrative: item.receiptNumber ? "AI extracted the receipt fields. Rule set 2026.07 then compared them with the ledger candidate; the reviewer owns the final decision." : "The ledger payment gap created this candidate. A receipt is still needed before the evidence can be matched.",
    evidence: [
      { label: "Invoice", reference: item.invoiceReference, detail: formatNaira(item.invoiceGrossKobo / 100), state: "verified" },
      { label: "Payment", reference: "Imported ledger", detail: formatNaira(item.paymentNetKobo / 100), state: "verified" },
      { label: "WHT receipt", reference: item.receiptNumber || "Missing", detail: receiptAmount === null ? "Upload required" : formatNaira(receiptAmount), state: item.receiptNumber ? (item.exceptionCode === "NO_OPEN_EXCEPTION" ? "verified" : "warning") : "missing" },
      { label: "Authority record", reference: "Not connected", detail: "Future integration", state: "pending" },
    ],
    checks: [
      { label: "Invoice reference", bookValue: item.invoiceReference, evidenceValue: item.receiptNumber ? item.invoiceReference : "Not provided", result: item.receiptNumber ? "match" : "missing" },
      { label: "Beneficiary TIN", bookValue: item.customerTin || "Not provided", evidenceValue: item.receiptBeneficiaryTin || "Not extracted", result: !item.receiptBeneficiaryTin ? "missing" : tinMatches ? "match" : "mismatch" },
      { label: "WHT amount", bookValue: formatNaira(amount), evidenceValue: receiptAmount === null ? "Not extracted" : formatNaira(receiptAmount), result: receiptAmount === null ? "missing" : amountMatches ? "match" : "mismatch" },
      { label: "Reporting period", bookValue: item.reportingPeriod || "Not provided", evidenceValue: item.reportingPeriod || "Not extracted", result: item.reportingPeriod ? "match" : "missing" },
    ],
  };
}

function StageBadge({ stage }: { stage: CaseStage }) {
  return <span className={`stage-badge stage-${stage}`}>{stageLabels[stage]}</span>;
}

function AppMark() {
  return (
    <div className="app-mark" aria-hidden="true">
      <span>W</span>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [cases, setCases] = useState(initialCases);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CaseStage | "all">("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [draftVisible, setDraftVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ configured: false, model: "deepseek-v4-flash", provider: "DeepSeek", release: "V4 Flash 0731" });
  const [importBatches, setImportBatches] = useState([
    { name: "July WHT ledger.csv", rows: 184, status: "Validated", time: "Today, 08:32" },
    { name: "Receipt bundle 07.pdf", rows: 27, status: "Reviewed", time: "Yesterday, 15:11" },
  ]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    const loadPersistentData = async () => {
      try {
        const [caseResponse, healthResponse] = await Promise.all([fetch("/api/cases"), fetch("/api/health")]);
        if (healthResponse.ok) {
          const health = await healthResponse.json() as { ai?: AiStatus };
          if (active && health.ai) setAiStatus(health.ai);
        }
        if (!caseResponse.ok) return;
        const data = await caseResponse.json() as {
          cases?: PersistentCase[];
          documents?: Array<{ name: string; rows: number; status: string; createdAt: string }>;
        };
        if (!active) return;
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases((current) => [...persisted, ...current.filter((item) => !persisted.some((saved) => saved.id === item.id))]);
        if (data.documents?.length) setImportBatches(data.documents.map((document) => ({ name: document.name, rows: document.rows, status: document.status.replaceAll("_", " "), time: new Date(document.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) })));
      } catch {
        // The seeded portfolio remains usable when local bindings have not started yet.
      }
    };
    void loadPersistentData();
    return () => { active = false; };
  }, []);

  const selectedCase = cases.find((item) => item.id === selectedId) ?? null;
  const openCases = cases.filter((item) => item.stage !== "closed");
  const openAmount = openCases.reduce((total, item) => total + item.amount, 0);
  const recognisedAmount = cases
    .filter((item) => item.stage === "recognised" || item.stage === "closed")
    .reduce((total, item) => total + item.amount, 0);
  const interventionAmount = cases
    .filter((item) => item.stage === "evidence-needed" || item.stage === "in-dispute")
    .reduce((total, item) => total + item.amount, 0);

  const filteredCases = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return cases.filter((item) => {
      const matchesFilter = filter === "all" || item.stage === filter;
      const matchesQuery =
        !normalized ||
        [item.id, item.customer, item.invoice, item.exception]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [cases, filter, query]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  const openCase = (id: string) => {
    setSelectedId(id);
    setDraftVisible(false);
    setMobileNavOpen(false);
  };

  const changeCaseStage = async (id: string, stage: CaseStage) => {
    setCases((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              stage,
              updated: "Just now",
              nextAction:
                stage === "recognised"
                  ? "Confirm utilisation against the next eligible liability"
                  : stage === "closed"
                    ? "No further action"
                    : item.nextAction,
            }
          : item,
      ),
    );
    if (id.length > 10) {
      try {
        const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: id, stage, note: "Decision recorded from case workspace" }) });
        if (!response.ok) throw new Error("Review save failed");
      } catch {
        notify("The screen changed, but the persistent review could not be saved");
        return;
      }
    }
    notify(stage === "recognised" ? "Case marked as recognised and audited" : "Case closed with audit history preserved");
  };

  const processUpload = async (file: File, documentText?: string) => {
    const batch = {
      name: file.name,
      rows: file.name.toLowerCase().endsWith(".pdf") ? 1 : 0,
      status: "Processing",
      time: "Just now",
    };
    setImportBatches((current) => [batch, ...current]);
    setIsImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (documentText) form.set("documentText", documentText);
      const response = await fetch("/api/intake", { method: "POST", body: form });
      const result = await response.json() as { error?: string; document?: { rows?: number; rowCount?: number; status: string }; importedCases?: number; ai?: { configured?: boolean; message?: string } };
      if (!response.ok) throw new Error(result.error || "Import failed");
      const rows = result.document?.rowCount ?? result.document?.rows ?? result.importedCases ?? 1;
      const status = result.document?.status.replaceAll("_", " ") ?? "Complete";
      setImportBatches((current) => current.map((item, index) => index === 0 ? { ...item, rows, status } : item));
      if (result.ai?.configured === false) setAiStatus((current) => ({ ...current, configured: false }));
      notify(result.ai?.message || `${file.name} processed and saved`);
      const refresh = await fetch("/api/cases");
      if (refresh.ok) {
        const data = await refresh.json() as { cases?: PersistentCase[] };
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases((current) => [...persisted, ...current.filter((item) => !persisted.some((saved) => saved.id === item.id))]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      setImportBatches((current) => current.map((item, index) => index === 0 ? { ...item, status: "Failed" } : item));
      notify(message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await processUpload(file);
  };

  const handleReceiptText = async (text: string) => {
    const fileName = `wht-receipt-text-${new Date().toISOString().slice(0, 10)}.txt`;
    await processUpload(new File([text], fileName, { type: "text/plain" }), text);
  };

  const copyDraft = async () => {
    if (!selectedCase) return;
    const message = `Subject: WHT evidence required for ${selectedCase.invoice}\n\nHello ${selectedCase.customer} team,\n\nOur records show a WHT deduction of ${formatNaira(selectedCase.amount)} linked to invoice ${selectedCase.invoice}. ${selectedCase.nextAction}. Please share the supporting receipt or correction confirmation so we can complete our reconciliation.\n\nRegards,\nWHT Recovery Team`;
    await navigator.clipboard?.writeText(message);
    notify("Approved request copied to clipboard");
  };

  const downloadPack = () => {
    if (!selectedCase) return;
    const payload = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        disclaimer: "Synthetic portfolio demonstration. Practitioner validation required.",
        case: selectedCase,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedCase.id.toLowerCase()}-evidence-pack.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Evidence pack downloaded");
  };

  const navigate = (nextView: View) => {
    setView(nextView);
    setSelectedId(null);
    setMobileNavOpen(false);
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
          <button className="mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id && !selectedCase;
            return (
              <button key={item.id} className={active ? "active" : ""} onClick={() => navigate(item.id)}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === "cases" && <span className="nav-count">{openCases.length}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="pilot-chip">
            <ShieldCheck size={17} />
            <div>
              <strong>Practitioner review</strong>
              <span>Human approval required</span>
            </div>
          </div>
          <div className="profile-row">
            <div className="avatar">AO</div>
            <div>
              <strong>Adanna Okafor</strong>
              <span>Tax reviewer</span>
            </div>
            <Settings2 size={17} />
          </div>
        </div>
      </aside>

      {mobileNavOpen && <button className="nav-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}

      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className="entity-switcher">
            <span className="entity-mark">AC</span>
            <div>
              <strong>Aster Consulting Ltd</strong>
              <span>FY 2026 · Federal WHT</span>
            </div>
            <ChevronRight size={16} />
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Activity notifications">
              <Activity size={18} />
              <span className="notification-dot" />
            </button>
            <button className="primary-button" onClick={() => navigate("imports")}>
              <Upload size={17} />
              Import evidence
            </button>
          </div>
        </header>

        {selectedCase ? (
          <CaseWorkspace
            recoveryCase={selectedCase}
            draftVisible={draftVisible}
            onBack={() => setSelectedId(null)}
            onToggleDraft={() => setDraftVisible((value) => !value)}
            onCopyDraft={copyDraft}
            onDownload={downloadPack}
            onRecognise={() => changeCaseStage(selectedCase.id, "recognised")}
            onClose={() => changeCaseStage(selectedCase.id, "closed")}
          />
        ) : (
          <div className="content-area">
            {view === "overview" && (
              <Overview
                cases={cases}
                openAmount={openAmount}
                recognisedAmount={recognisedAmount}
                interventionAmount={interventionAmount}
                onOpenCase={openCase}
                onViewCases={() => navigate("cases")}
              />
            )}

            {view === "cases" && (
              <CasesView
                cases={filteredCases}
                query={query}
                filter={filter}
                onQueryChange={setQuery}
                onFilterChange={setFilter}
                onOpenCase={openCase}
              />
            )}

            {view === "imports" && (
              <ImportsView
                batches={importBatches}
                fileInputRef={fileInputRef}
                onImport={handleImport}
                onReceiptText={handleReceiptText}
                isImporting={isImporting}
                aiStatus={aiStatus}
              />
            )}

            {view === "rules" && <RulesView />}
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

function Overview({
  cases,
  openAmount,
  recognisedAmount,
  interventionAmount,
  onOpenCase,
  onViewCases,
}: {
  cases: RecoveryCase[];
  openAmount: number;
  recognisedAmount: number;
  interventionAmount: number;
  onOpenCase: (id: string) => void;
  onViewCases: () => void;
}) {
  const priorityCases = cases
    .filter((item) => item.stage !== "closed")
    .sort((a, b) => b.amount * Math.max(b.age, 1) - a.amount * Math.max(a.age, 1))
    .slice(0, 4);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Recovery control centre</p>
          <h1>Turn evidence gaps into next actions.</h1>
          <p>Prioritise material receivables, understand each exception, and carry cases through recognition.</p>
        </div>
        <div className="as-of">
          <Clock3 size={16} />
          Data refreshed 8 minutes ago
        </div>
      </section>

      <section className="metric-strip" aria-label="Portfolio summary">
        <div>
          <span>Open portfolio</span>
          <strong>{formatNaira(openAmount)}</strong>
          <small>Across 5 active cases</small>
        </div>
        <div>
          <span>Recognised or utilised</span>
          <strong>{formatNaira(recognisedAmount)}</strong>
          <small className="positive-copy">34% of reviewed value</small>
        </div>
        <div>
          <span>Needs intervention</span>
          <strong>{formatNaira(interventionAmount)}</strong>
          <small>Missing evidence or dispute</small>
        </div>
        <div>
          <span>Median open age</span>
          <strong>42 days</strong>
          <small>Oldest case is 134 days</small>
        </div>
      </section>

      <div className="overview-grid">
        <section className="work-panel priority-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Value at risk</p>
              <h2>Priority recovery queue</h2>
            </div>
            <button className="text-button" onClick={onViewCases}>
              View all cases <ArrowUpRight size={16} />
            </button>
          </div>
          <RecoveryTable cases={priorityCases} onOpenCase={onOpenCase} compact />
        </section>

        <aside className="work-panel portfolio-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Evidence position</p>
              <h2>Portfolio coverage</h2>
            </div>
            <Gauge size={19} />
          </div>
          <div className="coverage-score">
            <div>
              <strong>68%</strong>
              <span>of open value has at least one supporting document</span>
            </div>
            <div className="coverage-ring" aria-label="68 percent evidence coverage">
              <span>68</span>
            </div>
          </div>
          <div className="pipeline-list">
            <PipelineRow label="Detected" value="₦310k" count={1} width="28%" tone="neutral" />
            <PipelineRow label="Evidence needed" value="₦185k" count={1} width="18%" tone="amber" />
            <PipelineRow label="In dispute" value="₦750k" count={1} width="68%" tone="red" />
            <PipelineRow label="Recognised" value="₦420k" count={1} width="42%" tone="green" />
          </div>
        </aside>
      </div>

      <section className="activity-band">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Recent movement</p>
            <h2>Case activity</h2>
          </div>
        </div>
        <div className="activity-list">
          <div>
            <span className="activity-icon success"><BadgeCheck size={17} /></span>
            <p><strong>Civic Works</strong> credit matched to authority record <span>29 Jul · AO</span></p>
          </div>
          <div>
            <span className="activity-icon warning"><CircleAlert size={17} /></span>
            <p><strong>Alpha Energy</strong> moved to dispute after TIN validation <span>Today · System</span></p>
          </div>
          <div>
            <span className="activity-icon neutral"><Mail size={17} /></span>
            <p><strong>Metro Foods</strong> receipt request drafted for approval <span>Yesterday · AA</span></p>
          </div>
        </div>
      </section>
    </>
  );
}

function PipelineRow({
  label,
  value,
  count,
  width,
  tone,
}: {
  label: string;
  value: string;
  count: number;
  width: string;
  tone: string;
}) {
  return (
    <div className="pipeline-row">
      <div><span>{label}</span><span>{count} case</span></div>
      <div className="pipeline-track"><span className={`pipeline-fill ${tone}`} style={{ width }} /></div>
      <strong>{value}</strong>
    </div>
  );
}

function CasesView({
  cases,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onOpenCase,
}: {
  cases: RecoveryCase[];
  query: string;
  filter: CaseStage | "all";
  onQueryChange: (value: string) => void;
  onFilterChange: (value: CaseStage | "all") => void;
  onOpenCase: (id: string) => void;
}) {
  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <p className="eyebrow">Receivable ledger</p>
          <h1>Recovery cases</h1>
          <p>Every suspected deduction, its evidence position, and the next accountable action.</p>
        </div>
      </section>

      <section className="work-panel case-list-panel">
        <div className="case-toolbar">
          <label className="search-field">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search customer, invoice or exception"
              aria-label="Search recovery cases"
            />
          </label>
          <label className="filter-field">
            <ListFilter size={17} />
            <select value={filter} onChange={(event) => onFilterChange(event.target.value as CaseStage | "all")}>
              <option value="all">All statuses</option>
              {Object.entries(stageLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
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

function RecoveryTable({
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
            <th><span className="sr-only">Open case</span></th>
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => (
            <tr key={item.id} onClick={() => onOpenCase(item.id)} tabIndex={0} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onOpenCase(item.id);
            }}>
              <td><strong>{item.customer}</strong><span>{item.invoice} · {item.id}</span></td>
              <td className="numeric"><strong>{formatNaira(item.amount)}</strong><span>{item.confidence}% confidence</span></td>
              <td><StageBadge stage={item.stage} /></td>
              {!compact && <td><span className="exception-copy">{item.exception}</span></td>}
              <td><strong>{item.age ? `${item.age}d` : "—"}</strong></td>
              <td><span className={item.owner === "Unassigned" ? "owner unassigned" : "owner"}>{item.owner}</span></td>
              <td><button className="row-button" aria-label={`Open ${item.customer} case`}><ChevronRight size={17} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportsView({
  batches,
  fileInputRef,
  onImport,
  onReceiptText,
  isImporting,
  aiStatus,
}: {
  batches: { name: string; rows: number; status: string; time: string }[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onReceiptText: (text: string) => Promise<void>;
  isImporting: boolean;
  aiStatus: AiStatus;
}) {
  const [receiptText, setReceiptText] = useState("");

  const submitReceiptText = async () => {
    const text = receiptText.trim();
    if (text.length < 20) return;
    await onReceiptText(text);
    setReceiptText("");
  };

  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <p className="eyebrow">Evidence intake</p>
          <h1>Bring the source records together.</h1>
          <p>Upload ledger exports and supporting documents. Originals remain unchanged and traceable.</p>
        </div>
      </section>

      <div className="intake-grid">
        <section className="upload-zone">
          <div className="upload-symbol"><Upload size={24} /></div>
          <h2>Upload a new batch</h2>
          <p>Upload ledgers as CSV. PDF and image originals are retained for the OCR stage; receipt text goes to DeepSeek.</p>
          <input ref={fileInputRef} type="file" accept=".csv,.txt,.pdf,.png,.jpg,.jpeg,.webp" onChange={onImport} className="sr-only" />
          <button className="primary-button" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
            {isImporting ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />}
            {isImporting ? "Processing evidence…" : "Choose file"}
          </button>
          <small>Maximum 1 MB per file · CSV/TXT or compressed PDF/image evidence</small>
        </section>

        <aside className="intake-guide">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Before upload</p>
              <h2>Minimum useful fields</h2>
            </div>
            <BookOpenCheck size={19} />
          </div>
          <ul>
            <li><Check size={16} /> Invoice reference and gross amount</li>
            <li><Check size={16} /> Customer name and identifier</li>
            <li><Check size={16} /> Payment date and net amount</li>
            <li><Check size={16} /> Receipt number, period and beneficiary TIN</li>
          </ul>
          <div className={`ai-readiness ${aiStatus.configured ? "ready" : "setup"}`}>
            <Sparkles size={16} />
            <div><strong>{aiStatus.configured ? "DeepSeek extraction active" : "DeepSeek key required"}</strong><span>{aiStatus.configured ? `${aiStatus.release || aiStatus.model} extracts receipt text; rules make the match.` : "Uploads persist safely; text extraction waits for DEEPSEEK_API_KEY."}</span></div>
          </div>
          <p>Column mapping and validation happen before any recovery case is created.</p>
        </aside>
      </div>

      <section className="receipt-text-panel">
        <div>
          <p className="section-kicker">DeepSeek text intake</p>
          <h2>Paste receipt text or OCR output</h2>
          <p>DeepSeek V4 Flash 0731 is text-only. Paste text from a digital PDF or OCR scan; the original file can still be uploaded separately for provenance.</p>
        </div>
        <label>
          <span className="sr-only">WHT receipt text</span>
          <textarea value={receiptText} onChange={(event) => setReceiptText(event.target.value)} placeholder="Receipt no: RCP-22814&#10;Beneficiary TIN: 01234567-0001&#10;Invoice: INV-1042&#10;WHT amount: NGN 750,000&#10;Period: March 2026" />
        </label>
        <button className="primary-button" disabled={isImporting || receiptText.trim().length < 20} onClick={() => void submitReceiptText()}>
          {isImporting ? <RefreshCw className="spin" size={17} /> : <Sparkles size={17} />}
          Extract with DeepSeek
        </button>
      </section>

      <section className="work-panel batch-panel">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Import history</p>
            <h2>Recent batches</h2>
          </div>
          <RefreshCw size={18} />
        </div>
        <div className="batch-list">
          {batches.map((batch, index) => (
            <div key={`${batch.name}-${index}`}>
              <span className="document-icon"><FileText size={18} /></span>
              <div><strong>{batch.name}</strong><span>{batch.rows || "—"} records · {batch.time}</span></div>
              <span className={`batch-status ${batch.status === "Processing" ? "processing" : ""}`}>{batch.status}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function RulesView() {
  const rules = [
    { name: "AI receipt extraction", logic: "DeepSeek V4 Flash 0731 converts receipt text into source-grounded fields", control: "AI cannot recognise or close a case", status: "Assistive" },
    { name: "Payment-gap candidate", logic: "Invoice gross less matched payment exceeds configured tolerance", control: "Reviewer confirms applicability", status: "Active" },
    { name: "Beneficiary identity", logic: "Receipt TIN must equal the approved entity master TIN", control: "Exact match required", status: "Active" },
    { name: "Receipt amount", logic: "Expected, receipt and authority amounts are compared separately", control: "Partial states preserved", status: "Active" },
    { name: "External communication", logic: "Drafts use case facts and evidence references only", control: "Human approval required", status: "Enforced" },
  ];

  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <p className="eyebrow">Decision controls</p>
          <h1>Rules & controls</h1>
          <p>AI extracts document facts. Deterministic rules compare them. Practitioner judgment remains visible and accountable.</p>
        </div>
      </section>

      <section className="rule-summary">
        <div>
          <span className="rule-icon"><ShieldCheck size={21} /></span>
          <div><strong>Rule set 2026.07</strong><span>Effective 1 July 2026 · Approved by AO</span></div>
        </div>
        <span className="stage-badge stage-recognised">Current</span>
      </section>

      <section className="work-panel rule-panel">
        <div className="rule-list">
          {rules.map((rule, index) => (
            <div className="rule-row" key={rule.name}>
              <span className="rule-number">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{rule.name}</strong><span>{rule.logic}</span></div>
              <div><strong>Control</strong><span>{rule.control}</span></div>
              <span className="rule-status">{rule.status}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="control-note">
        <CircleAlert size={19} />
        <p><strong>Rates and administrative procedures are configuration, not application code.</strong> Every match run records the rule version used so later changes do not rewrite history.</p>
      </div>
    </>
  );
}

function CaseWorkspace({
  recoveryCase,
  draftVisible,
  onBack,
  onToggleDraft,
  onCopyDraft,
  onDownload,
  onRecognise,
  onClose,
}: {
  recoveryCase: RecoveryCase;
  draftVisible: boolean;
  onBack: () => void;
  onToggleDraft: () => void;
  onCopyDraft: () => void;
  onDownload: () => void;
  onRecognise: () => void;
  onClose: () => void;
}) {
  const verifiedCount = recoveryCase.evidence.filter((item) => item.state === "verified").length;
  const allMatched = recoveryCase.checks.every((item) => item.result === "match");

  return (
    <div className="case-workspace">
      <div className="case-topline">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Back to cases</button>
        <div className="case-actions">
          <button className="secondary-button" onClick={onDownload}><Download size={17} /> Export pack</button>
          {recoveryCase.stage === "recognised" ? (
            <button className="primary-button" onClick={onClose}><CheckCircle2 size={17} /> Close as utilised</button>
          ) : (
            <button className="primary-button" onClick={onToggleDraft}><Mail size={17} /> Draft next action</button>
          )}
        </div>
      </div>

      <section className="case-hero">
        <div>
          <div className="case-title-row"><StageBadge stage={recoveryCase.stage} /><span>{recoveryCase.id}</span></div>
          <h1>{recoveryCase.customer}</h1>
          <p>{recoveryCase.invoice} · {recoveryCase.exception}</p>
        </div>
        <div className="case-amount">
          <span>Expected WHT</span>
          <strong>{formatNaira(recoveryCase.amount)}</strong>
          <small>{recoveryCase.confidence}% evidence confidence</small>
        </div>
      </section>

      <section className="case-facts">
        <div><span>Case age</span><strong>{recoveryCase.age ? `${recoveryCase.age} days` : "Closed"}</strong></div>
        <div><span>Owner</span><strong>{recoveryCase.owner}</strong></div>
        <div><span>Last movement</span><strong>{recoveryCase.updated}</strong></div>
        <div><span>Evidence coverage</span><strong>{verifiedCount} of 4 verified</strong></div>
      </section>

      <div className="case-layout">
        <div className="case-main-column">
          <section className="work-panel evidence-panel">
            <div className="section-heading">
              <div><p className="section-kicker">Source chain</p><h2>Evidence position</h2></div>
              <span className="confidence-label"><ShieldCheck size={16} /> {recoveryCase.confidence}% confidence</span>
            </div>
            <p className="case-narrative">{recoveryCase.narrative}</p>
            <div className="evidence-chain">
              {recoveryCase.evidence.map((item, index) => (
                <div className={`evidence-item evidence-${item.state}`} key={item.label}>
                  <span className="evidence-step">{index + 1}</span>
                  <div><span>{item.label}</span><strong>{item.reference}</strong><small>{item.detail}</small></div>
                  {item.state === "verified" ? <CheckCircle2 size={18} /> : item.state === "warning" ? <CircleAlert size={18} /> : <Clock3 size={18} />}
                </div>
              ))}
            </div>
          </section>

          <section className="work-panel match-panel">
            <div className="section-heading">
              <div><p className="section-kicker">Explainable matching</p><h2>Field comparison</h2></div>
              <span className="rule-version">Rules 2026.07</span>
            </div>
            <div className="match-table-wrap">
              <table className="match-table">
                <thead><tr><th>Field</th><th>Books</th><th>Evidence</th><th>Result</th></tr></thead>
                <tbody>
                  {recoveryCase.checks.map((check) => (
                    <tr key={check.label}>
                      <td><strong>{check.label}</strong></td>
                      <td>{check.bookValue}</td>
                      <td>{check.evidenceValue}</td>
                      <td><span className={`match-result ${check.result}`}>
                        {check.result === "match" ? <Check size={15} /> : <CircleAlert size={15} />}
                        {check.result === "match" ? "Match" : check.result === "missing" ? "Missing" : "Mismatch"}
                      </span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {draftVisible && (
            <section className="draft-panel" aria-live="polite">
              <div className="section-heading">
                <div><p className="section-kicker">Approval required</p><h2>Customer evidence request</h2></div>
                <button className="icon-button" onClick={onToggleDraft} aria-label="Close draft"><X size={18} /></button>
              </div>
              <div className="draft-meta"><span>To: Accounts payable, {recoveryCase.customer}</span><span>Case: {recoveryCase.id}</span></div>
              <div className="draft-copy">
                <strong>Subject: WHT evidence required for {recoveryCase.invoice}</strong>
                <p>Hello {recoveryCase.customer} team,</p>
                <p>Our records show a WHT deduction of {formatNaira(recoveryCase.amount)} linked to invoice {recoveryCase.invoice}. {recoveryCase.nextAction}. Please share the supporting receipt or correction confirmation so we can complete our reconciliation.</p>
                <p>Regards,<br />WHT Recovery Team</p>
              </div>
              <div className="draft-actions">
                <span><ShieldCheck size={16} /> No message is sent without reviewer approval.</span>
                <button className="primary-button" onClick={onCopyDraft}><Check size={17} /> Approve and copy</button>
              </div>
            </section>
          )}
        </div>

        <aside className="case-side-column">
          <section className="next-action-panel">
            <span className="action-icon"><Sparkles size={19} /></span>
            <p className="section-kicker">Recommended next action</p>
            <h2>{recoveryCase.nextAction}</h2>
            <p>Recommendation is based on the failed and missing evidence fields above.</p>
            {recoveryCase.stage !== "recognised" && recoveryCase.stage !== "closed" && (
              <button className="secondary-button full-button" onClick={onToggleDraft}><Mail size={17} /> Prepare request</button>
            )}
            {!allMatched && recoveryCase.stage !== "recognised" && recoveryCase.stage !== "closed" && (
              <button className="quiet-button full-button" onClick={onRecognise}><BadgeCheck size={17} /> Reviewer: mark recognised</button>
            )}
          </section>

          <section className="case-timeline">
            <div className="section-heading"><div><p className="section-kicker">Audit trail</p><h2>Case history</h2></div></div>
            <div className="timeline-list">
              <div><span /><p><strong>Match run completed</strong><small>{recoveryCase.updated} · Rules 2026.07</small></p></div>
              <div><span /><p><strong>{recoveryCase.exception}</strong><small>System exception recorded</small></p></div>
              <div><span /><p><strong>Candidate confirmed</strong><small>AO · Reviewer decision</small></p></div>
              <div><span /><p><strong>Case created</strong><small>Imported from July ledger</small></p></div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
