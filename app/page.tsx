/* CustomSelect exposes an accessible button name while its wrapping label supplies visible context. */
/* eslint-disable jsx-a11y/label-has-associated-control */
"use client";

import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  BookOpenCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  FileCheck2,
  FileSearch2,
  FileText,
  FolderClock,
  HardDrive,
  HelpCircle,
  History,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Mail,
  Menu,
  Moon,
  Paperclip,
  PencilLine,
  Quote,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Upload,
  Users,
  X,
} from "lucide-react";
import { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

type CaseStage =
  | "detected"
  | "evidence-needed"
  | "matched"
  | "in-dispute"
  | "recognised"
  | "closed"
  | "non-recoverable"
  | "written-off";

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
  sourceDocumentId?: string | null;
};

type View = "overview" | "cases" | "imports" | "rules" | "ai-activity" | "settings";
type CaseFilter = CaseStage | "all" | "open" | "needs-intervention";

type AiStatus = { configured: boolean; model: string; provider?: string; release?: string; demoFallback?: boolean };
type AppMode = "demo" | "live";
type SessionInfo = { user: { displayName: string; email: string }; workspace: { id: string; name: string; role: string }; clientId: string; localDevelopment: boolean };

type LedgerTargetField =
  | "customer_name" | "customer_tin" | "invoice_reference" | "invoice_gross_amount"
  | "payment_net_amount" | "payment_date" | "reporting_period" | "expected_wht_amount"
  | "currency" | "entity_reference" | "unmapped";

type LedgerMappingItem = {
  sourceColumn: string;
  targetField: LedgerTargetField;
  confidence?: number;
  reason?: string;
};

type LedgerValidation = {
  valid: boolean;
  validRows: number;
  rejectedRows: number;
  errors: string[];
  warnings: string[];
  deterministicCalculation?: string;
};
type LedgerWarning = string | { severity: string; column: string; message: string; affectedRows: number[] };

type LedgerWorkflow = {
  importId: string;
  status: string;
  headers: string[];
  preview: Record<string, string>[];
  detectedTypes: Record<string, string>;
  rowCount: number;
  truncated: boolean;
  mapping: {
    mappings: LedgerMappingItem[];
    detectedDateFormat?: string;
    detectedCurrency?: string;
    warnings: LedgerWarning[];
    unmappedColumns?: string[];
    overallConfidence?: number;
  };
  ai: { status: string; provider: string; model: string; promptVersion: string; jobId: string; safeMessage?: string };
  validation?: LedgerValidation;
};

type EvidenceWorkflow = {
  kind: "evidence";
  documentId: string;
  classification: { documentType: string; confidence: number; explanation: string; ocrRequired: boolean; appearsIncomplete: boolean; potentialDuplicate: boolean };
  duplicate: { id?: string; fileName?: string; createdAt?: string } | null;
  extraction: { fields: Array<{ fieldName: string; value: string; normalisedValue: string; confidence: number; sourceQuote: string; pageNumber: number | null; warnings: string[] }>; overallConfidence: number; untrustedInstructionsDetected: boolean } | null;
  candidates: Array<{ caseId: string; rank: number; confidence: number; reasons: string[]; conflicts: string[]; case?: { customer: string; invoiceReference: string; expectedWhtKobo: number; reportingPeriod: string } }>;
  recommendation: string;
  uncertainty: string;
  untrustedInstructionsDetected?: boolean;
};

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
  sourceDocumentId: string | null;
  updatedAt: string;
  nextAction?: string | null;
  assignedOwnerId?: string | null;
  authorityConnected?: number | boolean;
  clientTin?: string;
};

type ReviewField = {
  id: string;
  fieldName: string;
  originalValue: string;
  reviewedValue: string | null;
  effectiveValue: string;
  confidence: number;
  evidenceQuote: string;
  pageNumber: number | null;
  editable: boolean;
};

type ReviewData = {
  caseId: string;
  ruleVersion: string;
  document: {
    id: string;
    fileName: string;
    sha256: string;
    aiModel: string | null;
    aiResponseId: string | null;
    createdAt: string;
  } | null;
  fields: ReviewField[];
  review: { completed: boolean; eventId?: string; createdAt?: string };
};

type ReviewOutcome = { stage: CaseStage; exceptionCode: string; confidence: number };
type EvidenceSummary = { executiveSummary: string; exceptionNarrative: string; correspondenceSummary: string; resolutionHistory: string; outstandingItemsSummary: string; sourceLabels: string[] };

const stageLabels: Record<CaseStage, string> = {
  detected: "Detected",
  "evidence-needed": "Evidence needed",
  matched: "Partial match",
  "in-dispute": "In dispute",
  recognised: "Recognised",
  closed: "Closed",
  "non-recoverable": "Non-recoverable",
  "written-off": "Written off",
};

const ledgerFieldOptions: Array<{ value: LedgerTargetField; label: string }> = [
  { value: "unmapped", label: "Do not import" },
  { value: "customer_name", label: "Customer name *" },
  { value: "customer_tin", label: "Customer TIN" },
  { value: "invoice_reference", label: "Invoice reference *" },
  { value: "invoice_gross_amount", label: "Invoice gross amount *" },
  { value: "payment_net_amount", label: "Payment net amount *" },
  { value: "payment_date", label: "Payment date *" },
  { value: "reporting_period", label: "Reporting period *" },
  { value: "expected_wht_amount", label: "Expected WHT amount" },
  { value: "currency", label: "Currency" },
  { value: "entity_reference", label: "Entity reference" },
];

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

const initialImportBatches = [
  { name: "July WHT ledger.csv", rows: 184, status: "Validated", time: "Today, 08:32" },
  { name: "Receipt bundle 07.pdf", rows: 27, status: "Reviewed", time: "Yesterday, 15:11" },
];

const navItems = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "cases" as const, label: "Recovery cases", icon: FolderClock },
  { id: "imports" as const, label: "Data intake", icon: Upload },
  { id: "rules" as const, label: "Rules & controls", icon: SlidersHorizontal },
  { id: "ai-activity" as const, label: "AI activity", icon: Activity },
];

const formatNaira = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace("NGN", "₦");

const formatDays = (days: number) => days === 1 ? "1 day" : `${days} days`;

const exceptionLabels: Record<string, string> = {
  RECEIPT_MISSING: "Receipt missing",
  RECEIPT_FIELDS_MISSING: "Receipt fields missing",
  TIN_MISMATCH: "TIN mismatch",
  AMOUNT_MISMATCH: "Amount differs",
  PERIOD_MISMATCH: "Reporting period differs",
  INVOICE_MISMATCH: "Invoice reference differs",
  AUTHORITY_RECORD_MISSING: "Authority record not connected",
  APPLICABILITY_REVIEW_REQUIRED: "Applicability review required",
  APPLICABILITY_UNCERTAIN: "Applicability uncertain",
  WHT_NOT_APPLICABLE: "WHT not applicable",
  WHT_EXEMPT: "WHT exempt",
  AUTHORITY_MISMATCH: "Authority record differs",
  DEDUCTOR_TIN_MISMATCH: "Deducting customer TIN differs",
  BENEFICIARY_TIN_MISMATCH: "Beneficiary TIN differs",
  NO_OPEN_EXCEPTION: "No open exception",
};

function persistentCaseToView(item: PersistentCase): RecoveryCase {
  const storedStage = Object.hasOwn(stageLabels, item.stage) ? item.stage as CaseStage : "detected";
  const amount = item.expectedWhtKobo / 100;
  const receiptAmount = item.receiptAmountKobo === null ? null : item.receiptAmountKobo / 100;
  const hasReceipt = Boolean(item.receiptNumber && receiptAmount !== null);
  const stage: CaseStage = storedStage;
  const exceptionCode = item.exceptionCode;
  const amountMatches = receiptAmount !== null && Math.abs(receiptAmount - amount) <= 100;
  const tinMatches = Boolean(item.clientTin && item.receiptBeneficiaryTin && item.clientTin.replace(/\W/g, "") === item.receiptBeneficiaryTin.replace(/\W/g, ""));
  const authorityConnected = Boolean(item.authorityConnected);
  return {
    id: item.id,
    customer: item.customer,
    invoice: item.invoiceReference,
    amount,
    stage,
    exception: exceptionLabels[exceptionCode] ?? exceptionCode.replaceAll("_", " ").toLowerCase(),
    age: Math.max(0, Math.floor((Date.now() - new Date(item.updatedAt).getTime()) / 86_400_000)),
    owner: item.assignedOwnerId || "Unassigned",
    confidence: item.confidence,
    updated: new Date(item.updatedAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }),
    nextAction: item.nextAction || (!hasReceipt ? "Attach WHT receipt" : stage === "matched" ? "Connect and verify the authority record" : stage === "in-dispute" ? "Request a corrected receipt from the deducting customer" : "Review the evidence exception"),
    narrative: hasReceipt ? "Receipt fields were extracted and compared with the ledger candidate. The authority record must be connected before recognition." : "The ledger payment gap created this candidate. A WHT receipt is required before matching can continue.",
    evidence: [
      { label: "Invoice", reference: item.invoiceReference, detail: formatNaira(item.invoiceGrossKobo / 100), state: "verified" },
      { label: "Payment", reference: "Imported ledger", detail: formatNaira(item.paymentNetKobo / 100), state: "verified" },
      { label: "WHT receipt", reference: item.receiptNumber || "Missing", detail: receiptAmount === null ? "Attachment required" : formatNaira(receiptAmount), state: hasReceipt ? (item.exceptionCode === "NO_OPEN_EXCEPTION" ? "verified" : "warning") : "missing" },
      { label: "Authority record", reference: authorityConnected ? "Verified authority allocation" : "Not connected", detail: authorityConnected ? "Deterministic reconciliation passed" : "Required before recognition", state: authorityConnected ? "verified" : "missing" },
    ],
    checks: [
      { label: "Invoice reference", bookValue: item.invoiceReference, evidenceValue: item.receiptNumber ? item.invoiceReference : "Not provided", result: item.receiptNumber ? "match" : "missing" },
      { label: "Beneficiary TIN", bookValue: item.clientTin || "Entity TIN not configured", evidenceValue: item.receiptBeneficiaryTin || "Not extracted", result: !item.receiptBeneficiaryTin || !item.clientTin ? "missing" : tinMatches ? "match" : "mismatch" },
      { label: "WHT amount", bookValue: formatNaira(amount), evidenceValue: receiptAmount === null ? "Not extracted" : formatNaira(receiptAmount), result: receiptAmount === null ? "missing" : amountMatches ? "match" : "mismatch" },
      { label: "Reporting period", bookValue: item.reportingPeriod || "Not provided", evidenceValue: item.reportingPeriod || "Not extracted", result: item.reportingPeriod ? "match" : "missing" },
    ],
    sourceDocumentId: item.sourceDocumentId,
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

type SelectOption<T extends string> = { value: T; label: string };

function CustomSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
}: {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
        return;
      }
      setActiveIndex((current) => event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length);
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(selectedIndex);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
    if (event.key === "Home" && open) { event.preventDefault(); setActiveIndex(0); }
    if (event.key === "End" && open) { event.preventDefault(); setActiveIndex(options.length - 1); }
  };

  return (
    <div className={`custom-select ${open ? "is-open" : ""} ${className}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="custom-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => { setOpen((current) => !current); setActiveIndex(selectedIndex); }}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="custom-select-menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              type="button"
              tabIndex={-1}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={index === activeIndex ? "active" : ""}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
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
  const [ledgerWorkflow, setLedgerWorkflow] = useState<LedgerWorkflow | null>(null);
  const [ledgerMappings, setLedgerMappings] = useState<LedgerMappingItem[]>([]);
  const [isLedgerActionRunning, setIsLedgerActionRunning] = useState(false);
  const [evidenceWorkflow, setEvidenceWorkflow] = useState<EvidenceWorkflow | null>(null);
  const [evidenceCaseId, setEvidenceCaseId] = useState("");
  const [evidenceReviewNote, setEvidenceReviewNote] = useState("");
  const [isEvidenceConfirming, setIsEvidenceConfirming] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ configured: false, model: "deepseek-v4-flash", provider: "DeepSeek", release: "V4 Flash 0731" });
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
        const [caseResponse, healthResponse, sessionResponse] = await Promise.all([fetch("/api/cases"), fetch("/api/health"), fetch("/api/session")]);
        if (sessionResponse.ok) {
          const loadedSession = await sessionResponse.json() as SessionInfo;
          if (active) setSession(loadedSession);
        }
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
        setCases(persisted);
        setImportBatches((data.documents ?? []).map((document) => ({ name: document.name, rows: document.rows, status: document.status.replaceAll("_", " "), time: new Date(document.createdAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) })));
      } catch {
        if (active) { setCases([]); setImportBatches([]); }
      }
    };
    void loadPersistentData();
    return () => { active = false; };
  }, [appMode]);

  const switchMode = (mode: AppMode) => {
    setAppMode(mode);
    setSelectedId(null);
    setLedgerWorkflow(null);
    setEvidenceWorkflow(null);
    window.localStorage.setItem("wht-app-mode", mode);
  };

  const toggleTheme = () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("wht-theme", next);
  };

  const selectedCase = cases.find((item) => item.id === selectedId) ?? null;
  const profileName = appMode === "live" ? session?.user.displayName ?? "Local practitioner" : "Adanna Okafor";
  const profileInitials = profileName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const openCases = cases.filter((item) => item.stage !== "closed");
  const openAmount = openCases.reduce((total, item) => total + item.amount, 0);
  const recognisedAmount = cases
    .filter((item) => item.stage === "recognised" || item.stage === "closed")
    .reduce((total, item) => total + item.amount, 0);
  const interventionAmount = cases
    .filter((item) => item.stage === "evidence-needed" || item.stage === "in-dispute")
    .reduce((total, item) => total + item.amount, 0);

  const filteredCases = useMemo(() => {
    const normalized = caseQuery.trim().toLowerCase();
    return cases.filter((item) => {
      const matchesFilter = filter === "all"
        || (filter === "open" && item.stage !== "closed")
        || (filter === "needs-intervention" && (item.stage === "evidence-needed" || item.stage === "in-dispute"))
        || item.stage === filter;
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
    return cases.filter((item) => [item.id, item.customer, item.invoice, item.exception].join(" ").toLowerCase().includes(normalized)).slice(0, 6);
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

  const changeCaseStage = async (id: string, stage: "recognised" | "closed") => {
    const target = cases.find((item) => item.id === id);
    if (appMode === "live") {
      if (!target?.sourceDocumentId) {
        notify("Live cases require persisted evidence before a review decision.");
        return;
      }
      try {
        const response = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId: id, action: stage === "recognised" ? "recognise" : "close", note: "Decision recorded from case workspace" }),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "Review save failed");
      } catch (error) {
        notify(error instanceof Error ? error.message : "The review decision could not be saved");
        return;
      }
    }
    setCases((current) => current.map((item) => item.id === id ? {
      ...item,
      stage,
      updated: "Just now",
      nextAction: stage === "recognised" ? "Confirm utilisation against the next eligible liability" : "No further action",
    } : item));
    notify(appMode === "live" ? (stage === "recognised" ? "Case marked as recognised and audited" : "Case closed with audit history preserved") : "Demo preview updated locally; no live record or audit event was created.");
  };

  const applyReviewOutcome = (id: string, effectiveValues: Record<string, string>, outcome: ReviewOutcome) => {
    setCases((current) => current.map((item) => {
      if (item.id !== id) return item;
      const normalizeValue = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
      const amount = Number((effectiveValues.wht_amount ?? "").replaceAll(",", ""));
      const amountMatches = Number.isFinite(amount) && Math.abs(amount - item.amount) <= 100;
      const evidenceByLabel: Record<string, string> = {
        Customer: effectiveValues.customer_name || "Not extracted",
        "Invoice reference": effectiveValues.invoice_reference || "Not extracted",
        "Beneficiary TIN": effectiveValues.beneficiary_tin || "Not extracted",
        "WHT amount": Number.isFinite(amount) ? formatNaira(amount) : "Not extracted",
        "Reporting period": effectiveValues.reporting_period || "Not extracted",
      };
      const checks = item.checks.map((check) => {
        const evidenceValue = evidenceByLabel[check.label] ?? check.evidenceValue;
        let result = check.result;
        if (check.label === "Beneficiary TIN") result = !effectiveValues.beneficiary_tin ? "missing" : normalizeValue(check.bookValue) === normalizeValue(effectiveValues.beneficiary_tin) ? "match" : "mismatch";
        if (check.label === "Invoice reference") result = !effectiveValues.invoice_reference ? "missing" : normalizeValue(item.invoice) === normalizeValue(effectiveValues.invoice_reference) ? "match" : "mismatch";
        if (check.label === "WHT amount") result = !Number.isFinite(amount) ? "missing" : amountMatches ? "match" : "mismatch";
        if (check.label === "Reporting period") result = !effectiveValues.reporting_period ? "missing" : normalizeValue(check.bookValue) === normalizeValue(effectiveValues.reporting_period) ? "match" : "mismatch";
        return { ...check, evidenceValue, result };
      });
      return {
        ...item,
        stage: outcome.stage,
        exception: exceptionLabels[outcome.exceptionCode] ?? outcome.exceptionCode,
        confidence: outcome.confidence,
        updated: "Just now",
        checks,
        narrative: "A reviewer confirmed the effective receipt fields. Deterministic rule set 2026.07 reran and the immutable review checkpoint was recorded.",
        nextAction: outcome.exceptionCode === "NO_OPEN_EXCEPTION" ? "Recognise the reviewed credit" : "Resolve the remaining deterministic exception",
      };
    }));
  };

  const processUpload = async (file: File, documentText?: string) => {
    if (appMode === "demo") {
      notify("Switch to Live workspace to upload and persist evidence. Demo data is read-only.");
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
      const response = await fetch("/api/intake", { method: "POST", body: form });
      setUploadProgress(82);
      const result = await response.json() as { error?: string; document?: { rows?: number; rowCount?: number; status: string }; importedCases?: number; ai?: { configured?: boolean; message?: string }; workflow?: LedgerWorkflow | EvidenceWorkflow };
      if (!response.ok) throw new Error(result.error || "Import failed");
      const rows = result.document?.rowCount ?? result.document?.rows ?? result.importedCases ?? 1;
      const status = result.document?.status.replaceAll("_", " ") ?? "Complete";
      setImportBatches((current) => current.map((item, index) => index === 0 ? { ...item, rows, status } : item));
      if (result.ai?.configured === false) setAiStatus((current) => ({ ...current, configured: false }));
      if (result.workflow && "importId" in result.workflow) {
        setLedgerWorkflow(result.workflow);
        setLedgerMappings(result.workflow.mapping.mappings);
      }
      if (result.workflow && "kind" in result.workflow) {
        setEvidenceWorkflow(result.workflow);
        setEvidenceCaseId(result.workflow.candidates[0]?.caseId ?? "");
        setEvidenceReviewNote("");
      }
      notify(result.workflow && "importId" in result.workflow ? "Mapping suggested. Confirm it before any recovery cases are created." : result.ai?.message || `${file.name} processed and saved`);
      setUploadProgress(100);
      if (result.workflow) return;
      const refresh = await fetch("/api/cases");
      if (refresh.ok) {
        const data = await refresh.json() as { cases?: PersistentCase[] };
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases(persisted);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      setImportBatches((current) => current.map((item, index) => index === 0 ? { ...item, status: "Failed" } : item));
      notify(message);
    } finally {
      setIsImporting(false);
      window.setTimeout(() => setUploadProgress(0), 900);
    }
  };

  const confirmEvidenceCandidate = async () => {
    if (!evidenceWorkflow || !evidenceCaseId || evidenceReviewNote.trim().length < 8) return;
    setIsEvidenceConfirming(true);
    try {
      const response = await fetch("/api/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: evidenceWorkflow.documentId, caseId: evidenceCaseId, note: evidenceReviewNote }) });
      const result = await response.json() as { error?: string; deterministic?: { exceptionCode: string } };
      if (!response.ok) throw new Error(result.error || "Evidence confirmation failed");
      setEvidenceWorkflow(null);
      const refresh = await fetch("/api/cases");
      if (refresh.ok) {
        const data = await refresh.json() as { cases?: PersistentCase[] };
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases(persisted);
      }
      notify(`Candidate confirmed. Deterministic result: ${result.deterministic?.exceptionCode?.replaceAll("_", " ") ?? "recorded"}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Evidence confirmation failed");
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
        body: JSON.stringify({ importId: ledgerWorkflow.importId, action: "validate", mappings: ledgerMappings }),
      });
      const result = await response.json() as { error?: string; status?: string; validation?: LedgerValidation };
      if (!response.ok || !result.validation || !result.status) throw new Error(result.error || "Ledger validation failed");
      setLedgerWorkflow((current) => current ? { ...current, status: result.status!, validation: result.validation } : current);
      notify(result.validation.valid ? `${result.validation.validRows} rows passed deterministic validation.` : "Validation found issues that must be resolved before import.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Ledger validation failed");
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
        body: JSON.stringify({ importId: ledgerWorkflow.importId, action: "import" }),
      });
      const result = await response.json() as { error?: string; status?: string; importedCases?: number };
      if (!response.ok) throw new Error(result.error || "Ledger import failed");
      setLedgerWorkflow((current) => current ? { ...current, status: "imported" } : current);
      setImportBatches((current) => current.map((item, index) => index === 0 ? { ...item, status: "Imported", rows: result.importedCases ?? item.rows } : item));
      const refresh = await fetch("/api/cases");
      if (refresh.ok) {
        const data = await refresh.json() as { cases?: PersistentCase[] };
        const persisted = (data.cases ?? []).map(persistentCaseToView);
        setCases(persisted);
      }
      notify(`${result.importedCases ?? 0} candidate cases created with immutable source links.`);
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
    await processUpload(new File([text], fileName, { type: "text/plain" }), text);
  };

  const copyDraft = async (messageOverride?: string, draftId?: string) => {
    if (!selectedCase) return;
    const message = messageOverride ?? `Subject: WHT evidence required for ${selectedCase.invoice}\n\nHello ${selectedCase.customer} team,\n\nOur records show a WHT deduction of ${formatNaira(selectedCase.amount)} linked to invoice ${selectedCase.invoice}. ${selectedCase.nextAction}. Please share the supporting receipt or correction confirmation so we can complete our reconciliation.\n\nRegards,\nWHT Recovery Team`;
    if (appMode === "live" && draftId) {
      const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve-draft", caseId: selectedCase.id, draftId, note: "Reviewed and approved for copying to the external communication channel" }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { notify(result.error || "Draft approval could not be recorded"); return; }
    }
    await navigator.clipboard?.writeText(message);
    notify(appMode === "live" && draftId ? "Draft approval recorded and request copied" : appMode === "demo" ? "Demo request copied; no approval event was recorded" : "Request copied to clipboard");
  };

  const downloadPack = async () => {
    if (!selectedCase) return;
    if (appMode === "live") {
      try {
        const response = await fetch("/api/audit-pack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: selectedCase.id }) });
        if (!response.ok) { const result = await response.json() as { error?: string }; throw new Error(result.error || "Audit pack could not be generated"); }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${selectedCase.id.toLowerCase()}-audit-pack.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        notify("Immutable audit pack downloaded");
      } catch (error) { notify(error instanceof Error ? error.message : "Audit pack could not be generated"); }
      return;
    }
    let assistedSummary: EvidenceSummary | null = null;
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "evidence-summary", caseId: selectedCase.id, documentId: selectedCase.sourceDocumentId, facts: { customer: selectedCase.customer, invoice: selectedCase.invoice, narrative: selectedCase.narrative, exception: selectedCase.exception, communicationStatus: "No external communication has been sent by the application.", historySummary: `Current stage: ${stageLabels[selectedCase.stage]}. Last movement: ${selectedCase.updated}.`, outstanding: selectedCase.evidence.filter((item) => item.state !== "verified").map((item) => `${item.label}: ${item.detail}`), checks: selectedCase.checks } }) });
      const result = await response.json() as { output?: EvidenceSummary };
      if (response.ok && result.output) assistedSummary = result.output;
    } catch { /* The deterministic report remains available when assistance is offline. */ }
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const assistedHtml = assistedSummary ? `<h2>AI-assisted evidence summary</h2><p>${escape(assistedSummary.executiveSummary)}</p><p><strong>Exception:</strong> ${escape(assistedSummary.exceptionNarrative)}</p><p><strong>Correspondence:</strong> ${escape(assistedSummary.correspondenceSummary)}</p><p><strong>Resolution history:</strong> ${escape(assistedSummary.resolutionHistory)}</p><p><strong>Outstanding:</strong> ${escape(assistedSummary.outstandingItemsSummary)}</p><small>Sources: ${escape(assistedSummary.sourceLabels.join(" · "))}</small>` : `<h2>Evidence summary</h2><p>${escape(selectedCase.narrative)}</p><p>AI assistance was unavailable; this section contains the current deterministic case narrative.</p>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(selectedCase.id)} evidence report</title><style>body{font:14px Inter,Arial,sans-serif;color:#172019;margin:40px}h1{font-size:26px}h2{font-size:17px;margin-top:28px}header{border-bottom:2px solid #673d65;padding-bottom:18px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.box{border:1px solid #dfe4e0;padding:12px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #dfe4e0;padding:9px}.notice{margin-top:32px;padding:12px;border-left:3px solid #b17aab;background:#f5eef4}@media print{body{margin:20mm}.no-print{display:none}}</style></head><body><header><small>WHT Recovery Control · Practitioner evidence report</small><h1>${escape(selectedCase.customer)}</h1><p>${escape(selectedCase.id)} · ${escape(selectedCase.invoice)} · Generated ${new Date().toLocaleString("en-NG")}</p></header><h2>Case summary</h2><div class="meta"><div class="box"><small>Expected WHT</small><br><strong>${escape(formatNaira(selectedCase.amount))}</strong></div><div class="box"><small>Status</small><br><strong>${escape(stageLabels[selectedCase.stage])}</strong></div><div class="box"><small>Exception</small><br><strong>${escape(selectedCase.exception)}</strong></div></div>${assistedHtml}<h2>Evidence chain</h2><table><thead><tr><th>Record</th><th>Reference</th><th>Position</th><th>State</th></tr></thead><tbody>${selectedCase.evidence.map((item) => `<tr><td>${escape(item.label)}</td><td>${escape(item.reference)}</td><td>${escape(item.detail)}</td><td>${escape(item.state)}</td></tr>`).join("")}</tbody></table><h2>Deterministic comparison</h2><table><thead><tr><th>Field</th><th>Books</th><th>Evidence</th><th>Result</th></tr></thead><tbody>${selectedCase.checks.map((item) => `<tr><td>${escape(item.label)}</td><td>${escape(item.bookValue)}</td><td>${escape(item.evidenceValue)}</td><td>${escape(item.result)}</td></tr>`).join("")}</tbody></table><h2>Current action</h2><p><strong>Next action:</strong> ${escape(selectedCase.nextAction)}</p><div class="notice"><strong>Practitioner validation required.</strong> This report preserves the application state at generation time. AI-assisted text does not recognise, utilise, close or write off a credit.</div></body></html>`;
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
          <div className="utility-nav" aria-label="Workspace utilities">
            <button disabled title="Support centre coming soon"><HelpCircle size={17} /><span>Support</span><small>Coming soon</small></button>
            <button className={view === "settings" && !selectedCase ? "active" : ""} onClick={() => navigate("settings")}><Settings2 size={17} /><span>Settings</span></button>
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
            aria-current={view === "settings" && !selectedCase ? "page" : undefined}
            title="Open settings"
          >
            <span className="avatar">{profileInitials}</span>
            <span className="profile-copy">
              <strong>{profileName}</strong>
              <span>{appMode === "live" ? session?.workspace.role.replaceAll("_", " ") ?? "Loading role" : "Tax reviewer"}</span>
            </span>
            <Settings2 size={17} />
          </button>
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
              <strong>{appMode === "live" ? session?.workspace.name ?? "Live workspace" : "Aster Consulting Ltd"}</strong>
              <span>{appMode === "live" ? `${session?.workspace.role?.replaceAll("_", " ") ?? "Loading access"} · persisted records` : "Demo portfolio · synthetic records"}</span>
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
                  if (event.key === "Enter" && globalResults[0]) openCase(globalResults[0].id);
                  if (event.key === "Escape") setGlobalQuery("");
                }}
                placeholder="Find customer, invoice or case"
                aria-label="Find customer, invoice or case"
              />
              <kbd>⌘ K</kbd>
            </label>
            {globalQuery && (
              <div className="command-results" role="listbox" aria-label="Case search results">
                {globalResults.length ? globalResults.map((item) => (
                  <button key={item.id} role="option" aria-selected="false" onClick={() => openCase(item.id)}>
                    <span><strong>{item.customer}</strong><small>{item.invoice} · {item.id}</small></span>
                    <StageBadge stage={item.stage} />
                  </button>
                )) : <p>No matching customers, invoices or cases.</p>}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <div className="mode-switch" role="group" aria-label="Workspace data mode">
              <button className={appMode === "demo" ? "active" : ""} onClick={() => switchMode("demo")} aria-pressed={appMode === "demo"}>Demo</button>
              <button className={appMode === "live" ? "active" : ""} onClick={() => switchMode("live")} aria-pressed={appMode === "live"}>Live</button>
            </div>
            <button className="icon-button" aria-label="Help centre coming soon" title="Help centre coming soon" disabled><HelpCircle size={18} /></button>
            <button className="icon-button theme-toggle" onClick={toggleTheme} aria-label="Toggle light or dark mode" title="Toggle light or dark mode">
              <Sun className="theme-icon-light" size={18} />
              <Moon className="theme-icon-dark" size={18} />
            </button>
            {view !== "imports" && !selectedCase && <button className="primary-button global-import" onClick={() => navigate("imports")} aria-label="Import evidence" title="Open data intake">
              <Upload size={18} strokeWidth={2.3} />
              <span>Import evidence</span>
            </button>}
          </div>
        </header>

        {appMode === "demo" && <div className="demo-mode-banner" role="status"><CircleAlert size={16} /><span><strong>Demo data</strong> — synthetic records are isolated from the live workspace. Changes remain in this browser and do not create audit events.</span><button onClick={() => switchMode("live")}>Open live workspace</button></div>}

        {selectedCase ? (
          <CaseWorkspace
            recoveryCase={selectedCase}
            draftVisible={draftVisible}
            onBack={() => { setSelectedId(null); window.scrollTo(0, 0); }}
            onToggleDraft={() => setDraftVisible((value) => !value)}
            onCopyDraft={copyDraft}
            onDownload={downloadPack}
            onRecognise={() => changeCaseStage(selectedCase.id, "recognised")}
            onClose={() => changeCaseStage(selectedCase.id, "closed")}
            onReviewComplete={(effectiveValues, outcome) => applyReviewOutcome(selectedCase.id, effectiveValues, outcome)}
            onNotify={notify}
            onAttachReceipt={() => navigate("imports")}
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
            {view === "ai-activity" && <AiActivityView onNotify={notify} onOpenCase={openCase} />}
            {view === "settings" && <SettingsView mode={appMode} session={session} onNotify={notify} onSwitchLive={() => switchMode("live")} onToggleTheme={toggleTheme} />}
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
  onFilterCases,
}: {
  cases: RecoveryCase[];
  openAmount: number;
  recognisedAmount: number;
  interventionAmount: number;
  onOpenCase: (id: string) => void;
  onViewCases: () => void;
  onFilterCases: (filter: CaseFilter) => void;
}) {
  const priorityCases = cases
    .filter((item) => item.stage !== "closed")
    .toSorted((a, b) => b.amount * Math.max(b.age, 1) - a.amount * Math.max(a.age, 1))
    .slice(0, 4);
  const activeCases = cases.filter((item) => item.stage !== "closed");
  const ages = activeCases.map((item) => item.age).toSorted((a, b) => a - b);
  const medianAge = ages.length ? ages[Math.floor(ages.length / 2)] : 0;
  const oldestAge = ages.at(-1) ?? 0;
  const coverageGroups = [
    { label: "Covered", stages: ["detected", "matched"] as CaseStage[], tone: "info" },
    { label: "Evidence missing", stages: ["evidence-needed"] as CaseStage[], tone: "warning" },
    { label: "Disputed", stages: ["in-dispute"] as CaseStage[], tone: "danger" },
    { label: "Recognised", stages: ["recognised", "closed"] as CaseStage[], tone: "success" },
  ].map((group) => ({
    ...group,
    value: cases.filter((item) => group.stages.includes(item.stage)).reduce((total, item) => total + item.amount, 0),
    count: cases.filter((item) => group.stages.includes(item.stage)).length,
  }));
  const coverageTotal = coverageGroups.reduce((total, group) => total + group.value, 0) || 1;

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
        <button className="intervention-summary" onClick={() => onFilterCases("needs-intervention")}>
          <span>Needs intervention</span>
          <strong>{formatNaira(interventionAmount)}</strong>
          <small>{cases.filter((item) => item.stage === "evidence-needed" || item.stage === "in-dispute").length} cases with missing or disputed evidence</small>
          <ChevronRight size={18} />
        </button>
        <div className="supporting-metrics">
          <button onClick={() => onFilterCases("open")}><span>Open value</span><strong>{formatNaira(openAmount)}</strong><small>{activeCases.length} active cases</small></button>
          <button onClick={() => onFilterCases("recognised")}><span>Recognised value</span><strong>{formatNaira(recognisedAmount)}</strong><small>Ready for utilisation or closed</small></button>
          <button onClick={() => onFilterCases("open")}><span>Median open age</span><strong>{formatDays(medianAge)}</strong><small>Oldest case: {formatDays(oldestAge)}</small></button>
        </div>
      </section>

      <PortfolioBriefingPanel cases={cases} onFilterCases={onFilterCases} />

      <div className="overview-grid">
        <section className="work-panel priority-panel">
          <div className="section-heading">
            <div><h2>Priority recovery queue</h2><p>Ranked by value and age.</p></div>
            <button className="text-button" onClick={onViewCases}>
              View all cases <ArrowUpRight size={16} />
            </button>
          </div>
          <RecoveryTable cases={priorityCases} onOpenCase={onOpenCase} compact />
        </section>

        <aside className="portfolio-panel">
          <div className="section-heading">
            <div><h2>Evidence coverage</h2><p>Value by current control position.</p></div>
          </div>
          <div className="coverage-stack" role="img" aria-label="Portfolio value split by evidence status">
            {coverageGroups.filter((group) => group.value > 0).map((group) => (
              <span key={group.label} className={`coverage-segment ${group.tone}`} style={{ width: `${(group.value / coverageTotal) * 100}%` }} title={`${group.label}: ${formatNaira(group.value)}`} />
            ))}
          </div>
          <div className="coverage-breakdown">
            {coverageGroups.map((group) => (
              <button key={group.label} onClick={() => onFilterCases(group.label === "Evidence missing" ? "evidence-needed" : group.label === "Disputed" ? "in-dispute" : group.label === "Recognised" ? "recognised" : "open")}>
                <span><i className={group.tone} />{group.label}<small>{group.count} {group.count === 1 ? "case" : "cases"}</small></span>
                <strong>{formatNaira(group.value)}</strong>
              </button>
            ))}
          </div>
        </aside>
      </div>

      <section className="activity-band">
        <div className="section-heading">
          <div><h2>Recent case activity</h2></div>
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
          <p>Review suspected deductions, evidence gaps and accountable next actions.</p>
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
                ...Object.entries(stageLabels).map(([value, label]) => ({ value: value as CaseStage, label })),
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
              <td data-label="Case"><strong>{item.customer}</strong><span>{item.invoice} · {item.id}</span></td>
              <td data-label="Expected WHT" className="numeric"><strong>{formatNaira(item.amount)}</strong><span>{item.confidence > 0 ? `${item.confidence}% evidence confidence` : "Confidence not assessed"}</span></td>
              <td data-label="Status"><StageBadge stage={item.stage} /></td>
              {!compact && <td data-label="Exception"><span className="exception-copy">{item.exception}</span></td>}
              <td data-label="Age"><strong>{item.age ? formatDays(item.age) : "—"}</strong></td>
              <td data-label="Owner"><span className={item.owner === "Unassigned" ? "owner unassigned" : "owner"}>{item.owner}</span></td>
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
  ledgerInputRef,
  evidenceInputRef,
  onImport,
  onReceiptText,
  isImporting,
  uploadProgress,
  aiStatus,
  ledgerWorkflow,
  ledgerMappings,
  onMappingChange,
  onValidateLedger,
  onImportLedger,
  isLedgerActionRunning,
  evidenceWorkflow,
  evidenceCaseId,
  evidenceReviewNote,
  onEvidenceCaseChange,
  onEvidenceReviewNoteChange,
  onConfirmEvidence,
  isEvidenceConfirming,
  onNotify,
  onViewCases,
}: {
  batches: { name: string; rows: number; status: string; time: string }[];
  ledgerInputRef: React.RefObject<HTMLInputElement | null>;
  evidenceInputRef: React.RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onReceiptText: (text: string) => Promise<void>;
  isImporting: boolean;
  uploadProgress: number;
  aiStatus: AiStatus;
  ledgerWorkflow: LedgerWorkflow | null;
  ledgerMappings: LedgerMappingItem[];
  onMappingChange: (mappings: LedgerMappingItem[]) => void;
  onValidateLedger: () => void;
  onImportLedger: () => void;
  isLedgerActionRunning: boolean;
  evidenceWorkflow: EvidenceWorkflow | null;
  evidenceCaseId: string;
  evidenceReviewNote: string;
  onEvidenceCaseChange: (caseId: string) => void;
  onEvidenceReviewNoteChange: (note: string) => void;
  onConfirmEvidence: () => void;
  isEvidenceConfirming: boolean;
  onNotify: (message: string) => void;
  onViewCases: () => void;
}) {
  const [receiptText, setReceiptText] = useState("");
  const receiptTextRef = useRef<HTMLTextAreaElement>(null);

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
          <h1>Data intake</h1>
          <p>Import ledger records and attach supporting evidence. Originals remain unchanged and traceable.</p>
        </div>
      </section>

      <div className="intake-grid">
        <section className="upload-workflow" aria-labelledby="upload-heading">
          <div className="section-heading">
            <div><h2 id="upload-heading">Import source records</h2><p>Choose the source type so the correct validation rules are applied.</p></div>
          </div>
          <div className="upload-options">
            <div className="upload-option">
              <span className="document-icon"><FileText size={19} /></span>
              <div><h3>Ledger records</h3><p>Invoices, payment values and customer identifiers.</p><small>CSV · maximum 1 MB during pilot</small></div>
              <input ref={ledgerInputRef} type="file" accept=".csv,text/csv" onChange={onImport} className="sr-only" tabIndex={-1} aria-hidden="true" />
              <button className="primary-button" onClick={() => ledgerInputRef.current?.click()} disabled={isImporting}>
                {isImporting ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />}
                Import ledger
              </button>
            </div>
            <div className="upload-option">
              <span className="document-icon"><Paperclip size={19} /></span>
              <div><h3>Supporting evidence</h3><p>WHT receipts and source documents retained for provenance.</p><small>PDF, PNG, JPG, WEBP or TXT · maximum 1 MB during pilot</small></div>
              <input ref={evidenceInputRef} type="file" accept=".txt,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp" onChange={onImport} className="sr-only" tabIndex={-1} aria-hidden="true" />
              <button className="secondary-button" onClick={() => evidenceInputRef.current?.click()} disabled={isImporting}>
                {isImporting ? <RefreshCw className="spin" size={17} /> : <Paperclip size={17} />}
                Attach evidence
              </button>
            </div>
          </div>
          {uploadProgress > 0 && (
            <div className="upload-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
              <span style={{ width: `${uploadProgress}%` }} />
              <small>{uploadProgress === 100 ? "Upload complete" : `Validating source · ${uploadProgress}%`}</small>
            </div>
          )}
        </section>

        <aside className="intake-guide">
          <div className="section-heading">
            <div><h2>Minimum ledger fields</h2></div>
            <BookOpenCheck size={19} />
          </div>
          <ul>
            <li><Check size={16} /> Invoice reference and gross amount</li>
            <li><Check size={16} /> Customer name and beneficiary TIN</li>
            <li><Check size={16} /> Payment date and net amount</li>
          </ul>
          <div className={`ai-readiness ${aiStatus.configured ? "ready" : "setup"}`}>
            {aiStatus.configured ? <FileCheck2 size={16} /> : <CircleAlert size={16} />}
            <div><strong>{aiStatus.configured ? aiStatus.demoFallback ? "Demo-mode receipt extraction available" : "AI-assisted receipt extraction available" : "Receipt extraction is temporarily unavailable"}</strong><span>{aiStatus.configured ? aiStatus.demoFallback ? "Deterministic pilot fixtures are active. Outputs remain reviewable and clearly recorded in AI activity." : "Extracted fields still require deterministic checks and practitioner review." : "Attach the original now and contact the workspace administrator."}</span></div>
          </div>
          <p>Column mapping and validation run before any recovery case is created.</p>
        </aside>
      </div>

      {ledgerWorkflow && (
        <section className="ledger-review" aria-labelledby="ledger-review-heading">
          <div className="ledger-review-head">
            <div>
              <h2 id="ledger-review-heading">Review ledger mapping</h2>
              <p>{ledgerWorkflow.rowCount} source rows · AI suggestions are provisional until you confirm and validate them.</p>
            </div>
            <span className={`batch-status ${ledgerWorkflow.status === "imported" || ledgerWorkflow.validation?.valid ? "complete" : "processing"}`}>
              {ledgerWorkflow.status.replaceAll("_", " ")}
            </span>
          </div>

          <ol className="workflow-steps" aria-label="Ledger import stages">
            {["Upload", "Preview", "Map", "Validate", "Import"].map((step, index) => {
              const active = ledgerWorkflow.status === "imported" ? index <= 4 : ledgerWorkflow.validation?.valid ? index <= 3 : index <= 2;
              return <li className={active ? "complete" : ""} key={step}><span>{active ? <Check size={14} /> : index + 1}</span>{step}</li>;
            })}
          </ol>

          <div className="mapping-layout">
            <div className="mapping-editor">
              <div className="mapping-header"><span>Source column</span><span>Map to</span><span>Suggestion</span></div>
              {ledgerMappings.map((mapping, index) => (
                <div className="mapping-row" key={mapping.sourceColumn}>
                  <span><strong>{mapping.sourceColumn}</strong><small>{ledgerWorkflow.detectedTypes[mapping.sourceColumn] ?? "text"}</small></span>
                  <CustomSelect
                    value={mapping.targetField}
                    disabled={ledgerWorkflow.status === "imported" || isLedgerActionRunning}
                    onChange={(targetField) => onMappingChange(ledgerMappings.map((item, mappingIndex) => mappingIndex === index ? { ...item, targetField } : item))}
                    ariaLabel={`Map ${mapping.sourceColumn}`}
                    options={ledgerFieldOptions}
                  />
                  <span className="mapping-reason">{mapping.confidence !== undefined ? `${mapping.confidence}%` : "Manual"}<small>{mapping.reason || "Reviewer selected"}</small></span>
                </div>
              ))}
            </div>

            <div className="ledger-preview-wrap">
              <h3>Source preview</h3>
              <div className="table-wrap">
                <table className="ledger-preview-table">
                  <thead><tr>{ledgerWorkflow.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                  <tbody>{ledgerWorkflow.preview.slice(0, 10).map((row, index) => <tr key={index}>{ledgerWorkflow.headers.map((header) => <td key={header}>{row[header] || "—"}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {ledgerWorkflow.truncated && <p className="preview-note">Preview limited to the first rows. Validation covers the complete file.</p>}
            </div>
          </div>

          {(ledgerWorkflow.mapping.warnings.length > 0 || ledgerWorkflow.validation) && (
            <div className={`validation-summary ${ledgerWorkflow.validation?.valid ? "valid" : ""}`}>
              {ledgerWorkflow.validation?.valid ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
              <div>
                <strong>{ledgerWorkflow.validation?.valid ? "Deterministic validation passed" : ledgerWorkflow.validation ? "Resolve validation issues" : "Review mapping warnings"}</strong>
                <p>{ledgerWorkflow.validation ? `${ledgerWorkflow.validation.validRows} valid rows · ${ledgerWorkflow.validation.rejectedRows} rejected` : "No recovery cases have been created."}</p>
                {[...(ledgerWorkflow.mapping.warnings ?? []), ...(ledgerWorkflow.validation?.errors ?? [])].slice(0, 8).map((warning, index) => {
                  const message = typeof warning === "string" ? warning : `${warning.column || "Ledger"}: ${warning.message}${warning.affectedRows?.length ? ` (rows ${warning.affectedRows.join(", ")})` : ""}`;
                  return <small key={`${message}-${index}`}>{message}</small>;
                })}
              </div>
            </div>
          )}

          <div className="ledger-actions">
            <p><LockKeyhole size={16} /> Mapping confirmation is recorded in the audit trail. Expected WHT remains a deterministic payment-gap calculation.</p>
            {ledgerWorkflow.status !== "imported" && !ledgerWorkflow.validation?.valid && <button className="primary-button" onClick={onValidateLedger} disabled={isLedgerActionRunning}>{isLedgerActionRunning ? <RefreshCw className="spin" size={17} /> : <Check size={17} />}Confirm mapping and validate</button>}
            {ledgerWorkflow.status !== "imported" && ledgerWorkflow.validation?.valid && <button className="primary-button" onClick={onImportLedger} disabled={isLedgerActionRunning}>{isLedgerActionRunning ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />}Create candidate cases</button>}
            {ledgerWorkflow.status === "imported" && <span className="review-state complete"><CheckCircle2 size={16} /> Imported</span>}
          </div>
        </section>
      )}

      {evidenceWorkflow && (
        <section className="evidence-review-workflow" aria-labelledby="evidence-review-heading">
          <div className="ledger-review-head">
            <div><h2 id="evidence-review-heading">Review extracted evidence</h2><p>Original content, field provenance and ranked candidates remain separate until you confirm a link.</p></div>
            <span className="batch-status processing">Practitioner decision required</span>
          </div>
          <div className="classification-strip">
            <div><span>Document type</span><strong>{evidenceWorkflow.classification.documentType.replaceAll("_", " ")}</strong></div>
            <div><span>Classification confidence</span><strong>{evidenceWorkflow.classification.confidence}%</strong></div>
            <div><span>Duplicate check</span><strong>{evidenceWorkflow.duplicate ? `Possible duplicate · ${evidenceWorkflow.duplicate.fileName ?? "existing document"}` : "No exact duplicate found"}</strong></div>
            <div><span>Content safety</span><strong>{evidenceWorkflow.untrustedInstructionsDetected ? "Untrusted instructions ignored" : "No instruction-like text detected"}</strong></div>
          </div>
          {evidenceWorkflow.extraction ? (
            <div className="evidence-review-grid">
              <div className="extraction-list">
                <h3>Extraction and provenance</h3>
                {evidenceWorkflow.extraction.fields.map((field) => <div className="extraction-field" key={field.fieldName}><div><strong>{field.fieldName.replaceAll("_", " ")}</strong><span>{field.value || "Not located"}</span></div><span className="field-confidence">{field.confidence}%</span><small>“{field.sourceQuote || "No supporting quote"}”{field.pageNumber ? ` · page ${field.pageNumber}` : ""}</small></div>)}
              </div>
              <div className="candidate-review">
                <h3>Candidate cases</h3>
                <p>{evidenceWorkflow.uncertainty}</p>
                <div className="candidate-list">
                  {evidenceWorkflow.candidates.length ? evidenceWorkflow.candidates.map((candidate) => <label className={evidenceCaseId === candidate.caseId ? "selected" : ""} key={candidate.caseId}><input type="radio" name="candidate-case" value={candidate.caseId} checked={evidenceCaseId === candidate.caseId} onChange={() => onEvidenceCaseChange(candidate.caseId)} /><span><strong>#{candidate.rank} · {candidate.case?.customer ?? candidate.caseId}</strong><small>{candidate.case?.invoiceReference ?? candidate.caseId} · {candidate.confidence}% ranking confidence</small><small>{candidate.reasons.join(" · ") || "No strong matching factor"}</small>{candidate.conflicts.length > 0 && <small className="conflict">Conflict: {candidate.conflicts.join(" · ")}</small>}</span></label>) : <div className="empty-candidates"><CircleAlert size={18} /> No eligible case was ranked. Continue through manual review.</div>}
                </div>
                <label className="review-note evidence-note"><span>Reviewer decision note</span><textarea value={evidenceReviewNote} onChange={(event) => onEvidenceReviewNoteChange(event.target.value)} placeholder="Explain why this document belongs to the selected case (required)." /></label>
                <button className="primary-button" disabled={!evidenceCaseId || evidenceReviewNote.trim().length < 8 || isEvidenceConfirming} onClick={onConfirmEvidence}>{isEvidenceConfirming ? <RefreshCw className="spin" size={17} /> : <ShieldCheck size={17} />}Confirm candidate and run controls</button>
                <small className="decision-warning">This records your selection, then runs deterministic comparisons. It does not recognise or close the case.</small>
              </div>
            </div>
          ) : <div className="manual-entry-state"><CircleAlert size={19} /><div><strong>Manual field entry required</strong><p>{evidenceWorkflow.uncertainty}</p></div></div>}
        </section>
      )}

      <section className="receipt-text-panel">
        <div>
          <h2>Paste receipt text or OCR output</h2>
          <p>Use text from a digital receipt or OCR scan. Attach the original separately to retain source provenance.</p>
        </div>
        <label>
          <span className="sr-only">WHT receipt text</span>
          <textarea ref={receiptTextRef} value={receiptText} onChange={(event) => setReceiptText(event.target.value)} placeholder="Receipt no: RCP-22814&#10;Beneficiary TIN: 01234567-0001&#10;Invoice: INV-1042&#10;WHT amount: NGN 750,000&#10;Period: March 2026" />
        </label>
        <button className="primary-button" disabled={isImporting || receiptText.trim().length < 20} onClick={() => void submitReceiptText()}>
          {isImporting ? <RefreshCw className="spin" size={17} /> : <ReceiptText size={17} />}
          Extract receipt fields
        </button>
      </section>

      <section className="batch-panel">
        <div className="section-heading">
          <div><h2>Recent batches</h2><p>Validation status and the next available action.</p></div>
        </div>
        <div className="table-wrap">
          <table className="batch-table">
            <thead><tr><th>Batch</th><th>Source</th><th>Status</th><th>Records</th><th>Date</th><th>Next action</th></tr></thead>
            <tbody>{batches.map((batch, index) => {
              const normalizedStatus = batch.status.toLowerCase();
              const failed = normalizedStatus.includes("failed");
              const processing = normalizedStatus.includes("processing");
              const textNeeded = normalizedStatus.includes("text extraction required");
              const extractionUnavailable = normalizedStatus.includes("ai configuration required");
              const statusLabel = failed ? "Failed" : processing ? "Validating" : textNeeded ? "Text needed" : extractionUnavailable ? "Extraction unavailable" : normalizedStatus.includes("validated") ? "Validated" : batch.status;
              const ledger = batch.name.toLowerCase().endsWith(".csv");
              return (
                <tr key={`${batch.name}-${index}`}>
                  <td><strong>{batch.name}</strong></td>
                  <td>{ledger ? "Ledger" : "Evidence"}</td>
                  <td><span className={`batch-status ${failed ? "failed" : processing || textNeeded || extractionUnavailable ? "processing" : "complete"}`}>{statusLabel}</span></td>
                  <td>{batch.rows || "—"}</td>
                  <td>{batch.time}</td>
                  <td>{failed ? <button className="text-button" onClick={() => (ledger ? ledgerInputRef : evidenceInputRef).current?.click()}>Retry</button> : processing ? <span className="muted-action">Validating</span> : textNeeded ? <button className="text-button" onClick={() => receiptTextRef.current?.focus()}>Add receipt text</button> : extractionUnavailable ? <button className="text-button" onClick={() => onNotify("Contact the workspace administrator to restore receipt extraction")}>Contact administrator</button> : <button className="text-button" onClick={onViewCases}>Review cases</button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function PortfolioBriefingPanel({ cases, onFilterCases }: { cases: RecoveryCase[]; onFilterCases: (filter: CaseFilter) => void }) {
  const [briefing, setBriefing] = useState<{ narrative: string; statements: Array<{ text: string; filter: string; caseIds: string[] }>; dataQualityWarning: string; sourceLabels: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    const intervention = cases.filter((item) => item.stage === "evidence-needed" || item.stage === "in-dispute");
    const largest = intervention.toSorted((a, b) => b.amount - a.amount)[0];
    setLoading(true);
    try {
      const response = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "portfolio-briefing", facts: { caseIds: cases.map((item) => item.id), interventionCount: intervention.length, interventionFormatted: formatNaira(intervention.reduce((sum, item) => sum + item.amount, 0)), interventionCaseIds: intervention.map((item) => item.id), largestCustomer: largest?.customer ?? "No blocked case", largestException: largest?.exception ?? "No open exception", largestCaseId: largest?.id ?? "", dataQualityWarning: `${cases.filter((item) => item.confidence < 70).length} cases have evidence confidence below 70%.` } }) });
      const result = await response.json() as { output?: typeof briefing };
      if (response.ok && result.output) setBriefing(result.output);
    } finally { setLoading(false); }
  };
  return <section className="portfolio-briefing"><div><FileSearch2 size={18} /><span><strong>Portfolio briefing</strong><small>{briefing ? briefing.narrative : "Generate a source-labelled summary from current deterministic portfolio totals."}</small></span></div>{briefing ? <><button className="text-button" onClick={() => onFilterCases("needs-intervention")}>Open intervention cases <ChevronRight size={15} /></button><small className="briefing-warning">{briefing.dataQualityWarning}</small></> : <button className="secondary-button" onClick={() => void generate()} disabled={loading}>{loading ? <RefreshCw className="spin" size={16} /> : <FileText size={16} />}Generate briefing</button>}</section>;
}

type AiActivityJob = { id: string; taskType: string; status: string; provider: string; model: string; promptVersion: string; inputHash: string; confidence: number | null; latencyMs: number | null; validationOutcome: string; sourceReferences: Array<{ type: string; id: string; label: string }>; caseId: string | null; documentId: string | null; errorCode: string | null; errorMessage: string | null; createdAt: string; completedAt: string | null; output?: unknown; humanCorrection?: unknown };
type AiActivityStatus = "completed" | "needs_review" | "failed" | "running";

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
  return aiTaskLabels[taskType] ?? taskType.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function aiActivityStatus(job: AiActivityJob): AiActivityStatus {
  if (job.status === "failed" || job.validationOutcome === "rejected") return "failed";
  if (job.status === "processing" || job.validationOutcome === "pending") return "running";
  if (job.status === "manual_review" || job.validationOutcome === "manual_review" || (job.status === "completed" && job.confidence === 0)) return "needs_review";
  return "completed";
}

function AiStatusLabel({ job }: { job: AiActivityJob }) {
  const status = aiActivityStatus(job);
  const labels = { completed: "Completed", needs_review: job.status === "completed" && job.confidence === 0 ? "Anomaly" : "Needs review", failed: "Failed", running: "Running" };
  const Icon = status === "completed" ? CheckCircle2 : status === "running" ? Clock3 : CircleAlert;
  return <span className={`ai-status ai-status-${status}`}><Icon size={14} aria-hidden="true" />{labels[status]}</span>;
}

function formatAiDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)).replace(" at ", ", ");
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

function AiActivityView({ onNotify, onOpenCase }: { onNotify: (message: string) => void; onOpenCase: (id: string) => void }) {
  const [jobs, setJobs] = useState<AiActivityJob[]>([]);
  const [loading, setLoading] = useState(true);
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
      const response = await fetch("/api/assistant");
      const result = await response.json() as { jobs?: AiActivityJob[]; error?: string };
      if (!response.ok) throw new Error(result.error || "AI activity is unavailable");
      setJobs(result.jobs ?? []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "AI activity is unavailable";
      setError(message);
      onNotify(message);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    let active = true;
    fetch("/api/assistant").then(async (response) => {
      const result = await response.json() as { jobs?: AiActivityJob[]; error?: string };
      if (!response.ok) throw new Error(result.error || "AI activity is unavailable");
      if (active) setJobs(result.jobs ?? []);
    }).catch((loadError) => {
      const message = loadError instanceof Error ? loadError.message : "AI activity is unavailable";
      if (active) setError(message);
      onNotify(message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onNotify]);

  const rangedJobs = useMemo(() => {
    if (range === "all") return jobs;
    const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
    const threshold = rangeAnchor - hours * 60 * 60 * 1000;
    return jobs.filter((job) => new Date(job.createdAt).getTime() >= threshold);
  }, [jobs, range, rangeAnchor]);

  const taskTypes = useMemo(() => Array.from(new Set(rangedJobs.map((job) => job.taskType))).sort((a, b) => aiTaskLabel(a).localeCompare(aiTaskLabel(b))), [rangedJobs]);
  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = rangedJobs.filter((job) => {
      const status = aiActivityStatus(job);
      const context = job.caseId ?? job.documentId ?? "Portfolio";
      const matchesQuery = !normalizedQuery || [aiTaskLabel(job.taskType), context, job.id, job.model, job.promptVersion, ...job.sourceReferences.flatMap((source) => [source.id, source.label])].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesTask = taskFilter === "all" || job.taskType === taskFilter;
      const matchesConfidence = confidenceFilter === "all"
        || (confidenceFilter === "missing" && job.confidence === null)
        || (confidenceFilter === "high" && job.confidence !== null && job.confidence >= 85)
        || (confidenceFilter === "medium" && job.confidence !== null && job.confidence >= 60 && job.confidence < 85)
        || (confidenceFilter === "low" && job.confidence !== null && job.confidence < 60);
      return matchesQuery && matchesStatus && matchesTask && matchesConfidence;
    });
    return result.toSorted((a, b) => sort === "oldest" ? +new Date(a.createdAt) - +new Date(b.createdAt) : sort === "confidence" ? (b.confidence ?? -1) - (a.confidence ?? -1) : sort === "latency" ? (b.latencyMs ?? -1) - (a.latencyMs ?? -1) : +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [rangedJobs, query, statusFilter, taskFilter, confidenceFilter, sort]);

  const validated = rangedJobs.filter((job) => aiActivityStatus(job) === "completed").length;
  const needsReview = rangedJobs.filter((job) => aiActivityStatus(job) === "needs_review").length;
  const latencyValues = rangedJobs.map((job) => job.latencyMs).filter((value): value is number => value !== null).toSorted((a, b) => a - b);
  const medianLatency = latencyValues.length ? latencyValues[Math.floor(latencyValues.length / 2)] : null;
  const validationRate = rangedJobs.length ? (validated / rangedJobs.length) * 100 : 0;
  const hasFilters = Boolean(query || statusFilter !== "all" || taskFilter !== "all" || confidenceFilter !== "all" || sort !== "newest");
  const visibleJobs = filteredJobs.slice(0, visibleLimit);

  const clearFilters = () => { setQuery(""); setStatusFilter("all"); setTaskFilter("all"); setConfidenceFilter("all"); setSort("newest"); setVisibleLimit(20); };
  const contextFor = (job: AiActivityJob) => job.caseId ?? job.sourceReferences.find((source) => source.label)?.label ?? job.documentId ?? "Portfolio";
  const fullContextFor = (job: AiActivityJob) => job.caseId ?? job.documentId ?? job.sourceReferences[0]?.id ?? job.id;
  const copyContext = async (job: AiActivityJob) => { await navigator.clipboard.writeText(fullContextFor(job)); onNotify("Context identifier copied"); };
  const exportLog = () => {
    const header = ["Task", "Status", "Context", "Confidence", "Latency ms", "Created", "Validation"];
    const rows = filteredJobs.map((job) => [aiTaskLabel(job.taskType), aiActivityStatus(job), fullContextFor(job), job.confidence ?? "", job.latencyMs ?? "", job.createdAt, job.validationOutcome]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wht-ai-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderConfidence = (job: AiActivityJob) => {
    if (job.confidence === null) return <span className="confidence-missing">Not available</span>;
    const level = job.confidence < 60 ? "low" : job.confidence < 85 ? "medium" : "high";
    return <span className={`ai-confidence ai-confidence-${level}`}><span>{job.confidence}%</span><span className="confidence-track" aria-hidden="true"><span style={{ width: `${job.confidence}%` }} /></span></span>;
  };

  return <>
    <section className="page-heading ai-activity-heading"><div><h1>AI activity</h1><p>Review automated tasks, validation outcomes, confidence, latency, and human-review events.</p></div><div className="ai-heading-actions"><CustomSelect value={range} onChange={(nextRange) => { setRange(nextRange); setVisibleLimit(20); }} ariaLabel="Activity time range" options={[{ value: "24h", label: "Last 24 hours" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "all", label: "All time" }]} /><button className="icon-button" onClick={() => void loadJobs()} aria-label="Refresh AI activity" title="Refresh AI activity"><RefreshCw className={loading ? "spin" : ""} size={17} /></button><button className="secondary-button ai-export-button" onClick={exportLog} disabled={!filteredJobs.length}><Download size={16} />Export log</button></div></section>

    <section className="ai-operational-summary" aria-label="AI activity summary"><div><strong>{rangedJobs.length}</strong><span>Recorded tasks</span></div><div><strong>{validated}</strong><span>Validated</span></div><div className="review-summary"><CircleAlert size={17} aria-hidden="true" /><strong>{needsReview}</strong><span>Needs review</span></div><div><strong>{validationRate.toFixed(1)}%</strong><span>Validation rate</span></div><div><strong>{formatLatency(medianLatency)}</strong><span>Median latency</span></div></section>
    <p className="ai-governance-note"><ShieldCheck size={16} aria-hidden="true" />AI recommendations are assistive. Amounts, matches, and consequential status changes remain deterministic or reviewer-controlled.</p>

    <section className="ai-activity-workspace" aria-labelledby="activity-log-heading">
      <div className="ai-table-title"><div><h2 id="activity-log-heading">Activity log</h2><p>{filteredJobs.length} {filteredJobs.length === 1 ? "result" : "results"}</p></div><button className="secondary-button ai-mobile-filter-toggle" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="ai-filter-toolbar"><ListFilter size={16} />Filters{hasFilters && <span className="filter-count" aria-label="Filters active" />}</button></div>
      <div className={`ai-filter-toolbar ${filtersOpen ? "filters-open" : ""}`} id="ai-filter-toolbar">
        <label className="ai-search-field"><Search size={16} aria-hidden="true" /><span className="sr-only">Search tasks or context</span><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(20); }} placeholder="Search tasks or context" /></label>
        <CustomSelect value={statusFilter} onChange={(nextStatus) => { setStatusFilter(nextStatus); setVisibleLimit(20); }} ariaLabel="Filter by task status" options={[{ value: "all", label: "All statuses" }, { value: "completed", label: "Completed" }, { value: "needs_review", label: "Needs review" }, { value: "failed", label: "Failed" }, { value: "running", label: "Running" }]} />
        <CustomSelect value={taskFilter} onChange={(nextTask) => { setTaskFilter(nextTask); setVisibleLimit(20); }} ariaLabel="Filter by task type" options={[{ value: "all", label: "All task types" }, ...taskTypes.map((taskType) => ({ value: taskType, label: aiTaskLabel(taskType) }))]} />
        <CustomSelect value={confidenceFilter} onChange={(nextConfidence) => { setConfidenceFilter(nextConfidence); setVisibleLimit(20); }} ariaLabel="Filter by confidence" options={[{ value: "all", label: "All confidence" }, { value: "high", label: "High (85%+)" }, { value: "medium", label: "Medium (60–84%)" }, { value: "low", label: "Low (below 60%)" }, { value: "missing", label: "Not available" }]} />
        <CustomSelect value={sort} onChange={setSort} ariaLabel="Sort AI activity" options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "confidence", label: "Highest confidence" }, { value: "latency", label: "Longest latency" }]} />
        {hasFilters && <button className="text-button ai-clear-filters" onClick={clearFilters}>Clear filters</button>}
        <span className="ai-visible-count" aria-live="polite">Showing {visibleJobs.length} of {filteredJobs.length}</span>
      </div>

      {loading ? <div className="activity-skeleton" aria-label="Loading AI activity"><span /><span /><span /><span /><span /></div>
        : error ? <div className="ai-state"><CircleAlert size={22} /><h3>Activity log unavailable</h3><p>{error}</p><button className="secondary-button" onClick={() => void loadJobs()}><RefreshCw size={16} />Retry</button></div>
        : !jobs.length ? <div className="ai-state"><Activity size={22} /><h3>No AI activity yet</h3><p>Assisted imports, extraction, plans, and drafts will appear here with their validation record.</p></div>
        : !filteredJobs.length ? <div className="ai-state"><Search size={22} /><h3>No matching activity</h3><p>Change or clear the filters to view recorded tasks.</p><button className="secondary-button" onClick={clearFilters}>Clear filters</button></div>
        : <>
          <div className="ai-table-scroll"><table className="ai-jobs-table"><thead><tr><th>Task</th><th>Status</th><th className="ai-context-column">Context</th><th className="numeric-heading">Confidence</th><th className="numeric-heading ai-latency-column">Latency</th><th aria-sort={sort === "newest" ? "descending" : sort === "oldest" ? "ascending" : "none"}>Created</th><th><span className="sr-only">Row action</span></th></tr></thead><tbody>{visibleJobs.map((job) => <tr key={job.id} tabIndex={0} onClick={() => setSelected(job)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(job); } }} aria-label={`Inspect ${aiTaskLabel(job.taskType)} activity`}><td className="ai-task-cell"><strong>{aiTaskLabel(job.taskType)}</strong><span>{job.promptVersion}</span></td><td><AiStatusLabel job={job} /></td><td className="ai-context-cell ai-context-column"><span title={fullContextFor(job)}>{shortenContext(contextFor(job))}</span><button onClick={(event) => { event.stopPropagation(); void copyContext(job); }} aria-label={`Copy full context identifier for ${aiTaskLabel(job.taskType)}`} title={`Copy ${fullContextFor(job)}`}><Copy size={14} /></button></td><td className="ai-confidence-cell">{renderConfidence(job)}</td><td className="ai-latency-cell ai-latency-column">{formatLatency(job.latencyMs)}</td><td className="ai-created-cell">{formatAiDate(job.createdAt)}</td><td><button className="row-button" onClick={(event) => { event.stopPropagation(); setSelected(job); }} aria-label={`Inspect ${aiTaskLabel(job.taskType)} details`}><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>
          <div className="ai-mobile-list">{visibleJobs.map((job) => (
            // The structured mobile row intentionally behaves as one keyboard-selectable activity record.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
            <article key={job.id} tabIndex={0} onClick={() => setSelected(job)} onKeyDown={(event) => { if (event.key === "Enter") setSelected(job); }}><div><strong>{aiTaskLabel(job.taskType)}</strong><span>{job.promptVersion}</span></div><AiStatusLabel job={job} /><dl><div><dt>Confidence</dt><dd>{job.confidence === null ? "Not available" : `${job.confidence}%`}</dd></div><div><dt>Created</dt><dd>{formatAiDate(job.createdAt)}</dd></div></dl><button className="ai-mobile-context" onClick={(event) => { event.stopPropagation(); void copyContext(job); }} title={fullContextFor(job)}><span>{shortenContext(contextFor(job))}</span><Copy size={14} /><span className="sr-only">Copy full context identifier</span></button></article>
          ))}</div>
          {filteredJobs.length > visibleLimit && <div className="ai-load-more"><button className="secondary-button" onClick={() => setVisibleLimit((value) => value + 20)}>Load 20 more</button><span>{filteredJobs.length - visibleLimit} remaining</span></div>}
        </>}
    </section>

    {selected && <aside className="ai-job-drawer" aria-labelledby="ai-job-detail-title"><div className="ai-drawer-header"><div><span>Audit details</span><h2 id="ai-job-detail-title">{aiTaskLabel(selected.taskType)}</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close job details"><X size={17} /></button></div><div className="ai-drawer-body"><AiStatusLabel job={selected} /><dl className="ai-detail-grid"><div><dt>Workflow version</dt><dd>{selected.promptVersion}</dd></div><div><dt>Confidence</dt><dd>{selected.confidence === null ? "Not available" : `${selected.confidence}%`}</dd></div><div><dt>Latency</dt><dd>{formatLatency(selected.latencyMs)}</dd></div><div><dt>Created</dt><dd>{formatAiDate(selected.createdAt)}</dd></div><div><dt>Validation outcome</dt><dd>{selected.validationOutcome.replaceAll("_", " ")}</dd></div><div><dt>Reviewer requirement</dt><dd>{aiActivityStatus(selected) === "needs_review" ? "Practitioner review required" : selected.humanCorrection ? "Human-reviewed" : "No review recorded"}</dd></div></dl><section><div className="ai-detail-label"><h3>Context</h3><button onClick={() => void copyContext(selected)}><Copy size={14} />Copy</button></div><code>{fullContextFor(selected)}</code>{selected.caseId && <button className="secondary-button ai-open-case" onClick={() => onOpenCase(selected.caseId!)}>Open related case <ArrowUpRight size={15} /></button>}</section><section><h3>Decision ownership</h3><ul className="ai-ownership-list"><li><span className="ownership-ai">AI</span><div><strong>Generated recommendation</strong><small>Model output is advisory and retained with its workflow version.</small></div></li><li><span className="ownership-rule">Rule</span><div><strong>Validation outcome</strong><small>Application validation recorded: {selected.validationOutcome.replaceAll("_", " ")}.</small></div></li><li><span className="ownership-human">Human</span><div><strong>Reviewer control</strong><small>{selected.humanCorrection ? "A human correction is attached to this job." : "No human correction is attached to this job."}</small></div></li></ul></section><section><h3>Source references</h3>{selected.sourceReferences.length ? <ul className="ai-source-list">{selected.sourceReferences.map((source) => <li key={`${source.type}-${source.id}`}><strong>{source.label}</strong><span>{source.type}</span><code>{source.id}</code></li>)}</ul> : <p className="ai-detail-muted">No source reference was recorded.</p>}</section>{selected.output !== undefined && <section><h3>Output summary</h3><pre>{JSON.stringify(selected.output, null, 2)}</pre></section>}<section><h3>Audit metadata</h3><dl className="ai-audit-metadata"><div><dt>Job ID</dt><dd>{selected.id}</dd></div><div><dt>Input hash</dt><dd>{selected.inputHash}</dd></div><div><dt>Provider record</dt><dd>{selected.provider} · {selected.model}</dd></div></dl></section>{selected.errorMessage && <div className="ai-detail-error"><CircleAlert size={18} /><div><strong>{selected.errorCode ?? "Assistant error"}</strong><p>{selected.errorMessage}</p></div></div>}</div></aside>}
  </>;
}

type SettingsPayload = {
  workspace: { id: string; name: string; slug: string };
  client: { id: string; name: string; legalName: string; tin: string; jurisdiction: string };
  settings: { maxFileBytes: number; maxStorageBytes: number; retentionDays: number };
  members: Array<{ id: string; user_id: string; email: string; display_name: string; role: string; status: string; created_at: string }>;
  usage: { documentCount: number; storageBytes: number };
  ai: { configured: boolean; mode: string; provider: string };
  permissions: { canManageWorkspace: boolean; canManageMembers: boolean; canManageClient: boolean };
  currentUserId: string;
};

type SettingsSection = "general" | "evidence" | "access" | "ai-security";

const settingSections: Array<{ id: SettingsSection; label: string; description: string; icon: typeof Settings2 }> = [
  { id: "general", label: "Workspace and client", description: "Identity used across live cases", icon: Building2 },
  { id: "evidence", label: "Evidence governance", description: "File limits and retention", icon: HardDrive },
  { id: "access", label: "Access and roles", description: "Workspace membership", icon: Users },
  { id: "ai-security", label: "AI and security", description: "Operational safeguards", icon: ShieldCheck },
];

function SettingsView({ mode, session, onNotify, onSwitchLive, onToggleTheme }: { mode: AppMode; session: SessionInfo | null; onNotify: (message: string) => void; onSwitchLive: () => void; onToggleTheme: () => void }) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(mode === "live");
  const [saving, setSaving] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [clientName, setClientName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [tin, setTin] = useState("");
  const [jurisdiction, setJurisdiction] = useState("federal");
  const [maxFileBytes, setMaxFileBytes] = useState("1048576");
  const [maxStorageBytes, setMaxStorageBytes] = useState("25000000");
  const [retentionDays, setRetentionDays] = useState("365");

  const applyData = useCallback((payload: SettingsPayload) => {
    setData(payload);
    setWorkspaceName(payload.workspace.name);
    setClientName(payload.client.name);
    setLegalName(payload.client.legalName);
    setTin(payload.client.tin);
    setJurisdiction(payload.client.jurisdiction);
    setMaxFileBytes(String(payload.settings.maxFileBytes));
    setMaxStorageBytes(String(payload.settings.maxStorageBytes));
    setRetentionDays(String(payload.settings.retentionDays));
  }, []);

  const loadSettings = useCallback(async () => {
    if (mode !== "live") return;
    try {
      const response = await fetch("/api/settings");
      const payload = await response.json() as SettingsPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Settings are unavailable");
      applyData(payload);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Settings are unavailable"); }
    finally { setLoading(false); }
  }, [applyData, mode, onNotify]);

  useEffect(() => {
    if (mode !== "live") return;
    let active = true;
    fetch("/api/settings").then(async (response) => {
      const payload = await response.json() as SettingsPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Settings are unavailable");
      if (active) applyData(payload);
    }).catch((error) => onNotify(error instanceof Error ? error.message : "Settings are unavailable"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applyData, mode, onNotify]);

  const save = async (name: string, payload: Record<string, unknown>) => {
    setSaving(name);
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Settings could not be saved");
      await loadSettings();
      onNotify("Settings saved and added to audit history.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Settings could not be saved"); }
    finally { setSaving(null); }
  };

  const updateMemberRole = async (membershipId: string, role: string) => {
    await save(`member-${membershipId}`, { section: "member-role", membershipId, role });
  };

  if (mode === "demo") return <><section className="page-heading compact-heading"><div><h1>Settings</h1><p>Workspace configuration applies only to persisted live records.</p></div></section><section className="settings-demo-boundary"><LockKeyhole size={22} /><div><h2>Demo settings are isolated</h2><p>The synthetic portfolio does not have editable identity, access or retention settings. Switch to Live to manage the authenticated workspace.</p></div><button className="primary-button" onClick={onSwitchLive}>Open live settings</button></section></>;

  return <>
    <section className="page-heading compact-heading settings-heading"><div><h1>Settings</h1><p>Manage the live workspace, evidence policy and practitioner access.</p></div><span className="settings-scope"><LockKeyhole size={15} />{session?.workspace.name ?? "Live workspace"}</span></section>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">{settingSections.map((item) => { const Icon = item.icon; return <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)} aria-current={section === item.id ? "page" : undefined}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.description}</small></span><ChevronRight size={15} /></button>; })}</nav>
      <section className="settings-surface" aria-live="polite">{loading || !data ? <SettingsSkeleton /> : <>
        {section === "general" && <div className="settings-section"><div className="settings-section-title"><h2>Workspace and client</h2><p>These names and tax identifiers appear on cases, reports and audit packs.</p></div><form onSubmit={(event) => { event.preventDefault(); void save("workspace", { section: "workspace", name: workspaceName }); }}><fieldset disabled={!data.permissions.canManageWorkspace || saving !== null}><legend>Workspace identity</legend><label>Workspace name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} minLength={3} maxLength={100} required /></label><div className="settings-readonly"><span>Workspace ID</span><code>{data.workspace.id}</code></div><div className="settings-form-actions"><span>{data.permissions.canManageWorkspace ? "Changes are recorded in immutable audit history." : "Administrator access is required."}</span><button className="primary-button" type="submit" disabled={workspaceName.trim() === data.workspace.name || saving !== null}>{saving === "workspace" ? <RefreshCw className="spin" size={16} /> : <Check size={16} />}Save workspace</button></div></fieldset></form><form onSubmit={(event) => { event.preventDefault(); void save("client", { section: "client", name: clientName, legalName, tin, jurisdiction }); }}><fieldset disabled={!data.permissions.canManageClient || saving !== null}><legend>Default client</legend><div className="settings-form-grid"><label>Display name<input value={clientName} onChange={(event) => setClientName(event.target.value)} minLength={2} maxLength={100} required /></label><label>Legal name<input value={legalName} onChange={(event) => setLegalName(event.target.value)} minLength={2} maxLength={160} required /></label><label>Tax identification number<input value={tin} onChange={(event) => setTin(event.target.value)} placeholder="Enter approved entity TIN" maxLength={30} /></label><label>Jurisdiction<CustomSelect ariaLabel="Client jurisdiction" value={jurisdiction} onChange={setJurisdiction} options={[{ value: "federal", label: "Federal" }, { value: "state", label: "State" }, { value: "mixed", label: "Mixed" }]} /></label></div><div className="settings-form-actions"><span>Receipt beneficiary checks use this approved entity identity.</span><button className="primary-button" type="submit" disabled={saving !== null}>{saving === "client" ? <RefreshCw className="spin" size={16} /> : <Check size={16} />}Save client</button></div></fieldset></form></div>}
        {section === "evidence" && <div className="settings-section"><div className="settings-section-title"><h2>Evidence governance</h2><p>Set storage limits that match the current D1 document architecture.</p></div><div className="storage-position"><div><span>Stored evidence</span><strong>{data.usage.documentCount} {data.usage.documentCount === 1 ? "document" : "documents"}</strong></div><div><span>Storage used</span><strong>{(data.usage.storageBytes / 1_000_000).toFixed(2)} MB of {(data.settings.maxStorageBytes / 1_000_000).toFixed(0)} MB</strong></div><div className="storage-track" role="progressbar" aria-label="Workspace evidence storage used" aria-valuemin={0} aria-valuemax={data.settings.maxStorageBytes} aria-valuenow={data.usage.storageBytes}><span style={{ width: `${Math.min(100, data.usage.storageBytes / data.settings.maxStorageBytes * 100)}%` }} /></div></div><form onSubmit={(event) => { event.preventDefault(); void save("governance", { section: "governance", maxFileBytes: Number(maxFileBytes), maxStorageBytes: Number(maxStorageBytes), retentionDays: Number(retentionDays) }); }}><fieldset disabled={!data.permissions.canManageWorkspace || saving !== null}><legend>Document policy</legend><div className="settings-form-grid"><label>Maximum file size<CustomSelect ariaLabel="Maximum file size" value={maxFileBytes} onChange={setMaxFileBytes} options={[{ value: "250000", label: "250 KB" }, { value: "500000", label: "500 KB" }, { value: "1048576", label: "1 MB" }]} /><small>D1 row constraints limit individual originals to 1 MB.</small></label><label>Workspace storage limit<CustomSelect ariaLabel="Workspace storage limit" value={maxStorageBytes} onChange={setMaxStorageBytes} options={[{ value: "10000000", label: "10 MB" }, { value: "25000000", label: "25 MB" }, { value: "50000000", label: "50 MB" }, { value: "100000000", label: "100 MB" }]} /></label><label>Retention period<CustomSelect ariaLabel="Evidence retention period" value={retentionDays} onChange={setRetentionDays} options={[{ value: "90", label: "90 days" }, { value: "365", label: "1 year" }, { value: "1095", label: "3 years" }, { value: "2555", label: "7 years" }]} /><small>Deletion remains an administrator-controlled, audited action.</small></label></div><div className="settings-form-actions"><span>New uploads use this policy. Existing retention dates are not rewritten.</span><button className="primary-button" type="submit" disabled={saving !== null}>{saving === "governance" ? <RefreshCw className="spin" size={16} /> : <Check size={16} />}Save policy</button></div></fieldset></form></div>}
        {section === "access" && <div className="settings-section"><div className="settings-section-title"><h2>Access and roles</h2><p>Roles control settings, review decisions, reporting and case operations.</p></div><div className="settings-member-table" role="table" aria-label="Workspace members"><div role="row" className="settings-member-head"><span role="columnheader">Member</span><span role="columnheader">Status</span><span role="columnheader">Role</span></div>{data.members.map((member) => <div role="row" key={member.id}><span role="cell" className="settings-member-identity"><span className="avatar">{member.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><strong>{member.display_name}{member.user_id === data.currentUserId ? " (you)" : ""}</strong><small>{member.email}</small></span></span><span role="cell"><span className="member-status"><CheckCircle2 size={14} />{member.status}</span></span><span role="cell">{data.permissions.canManageMembers ? <CustomSelect ariaLabel={`Role for ${member.display_name}`} value={member.role} onChange={(role) => void updateMemberRole(member.id, role)} disabled={member.user_id === data.currentUserId || saving !== null} options={[{ value: "admin", label: "Administrator" }, { value: "practitioner", label: "Practitioner" }, { value: "reviewer", label: "Reviewer" }, { value: "analyst", label: "Analyst" }, { value: "read_only", label: "Read only" }]} /> : <span>{member.role.replaceAll("_", " ")}</span>}</span></div>)}</div><div className="settings-inline-note"><ShieldCheck size={17} /><p>Invitations are not enabled in this MVP. Identity is provisioned by the trusted authentication proxy, then assigned to an existing workspace by an administrator.</p></div></div>}
        {section === "ai-security" && <div className="settings-section"><div className="settings-section-title"><h2>AI and security</h2><p>Review service availability and controls without exposing provider secrets.</p></div><div className="settings-status-list"><div><span className={`settings-status-icon ${data.ai.configured ? "success" : "warning"}`}><Bot size={18} /></span><span><strong>AI-assisted receipt extraction</strong><small>{data.ai.configured ? `${data.ai.provider} is available. Outputs remain advisory and reviewable.` : "Receipt extraction is unavailable. Manual entry remains available."}</small></span><span className={`stage-badge ${data.ai.configured ? "stage-recognised" : "stage-evidence-needed"}`}>{data.ai.configured ? "Available" : "Action required"}</span></div><div><span className="settings-status-icon success"><LockKeyhole size={18} /></span><span><strong>Server-grounded assistant</strong><small>Case facts are rebuilt from workspace-scoped D1 records. Browser facts are ignored.</small></span><span className="stage-badge stage-recognised">Enforced</span></div><div><span className="settings-status-icon success"><History size={18} /></span><span><strong>Immutable audit history</strong><small>Update and delete triggers protect audit events. Settings changes record before and after values.</small></span><span className="stage-badge stage-recognised">Enforced</span></div><div><span className="settings-status-icon success"><ShieldCheck size={18} /></span><span><strong>Human decision gates</strong><small>Recognition and utilisation remain blocked until mandatory evidence controls pass.</small></span><span className="stage-badge stage-recognised">Enforced</span></div></div><div className="appearance-setting"><span><Sun size={18} /><span><strong>Appearance</strong><small>Switch between the dark operations theme and high-contrast light theme.</small></span></span><button className="secondary-button" onClick={onToggleTheme}><Sun size={16} />Toggle theme</button></div><div className="settings-inline-note"><CircleAlert size={17} /><p>Secrets are managed outside the product interface. Contact the deployment administrator to rotate or restore provider credentials.</p></div></div>}
      </>}</section>
    </div>
  </>;
}

function SettingsSkeleton() {
  return <div className="settings-skeleton" aria-label="Loading workspace settings"><span /><span /><span /><span /></div>;
}

function humaniseCopilotText(value: string) {
  return value.replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, (code) => code.toLowerCase().replaceAll("_", " "));
}

function copilotSourceLabel(source: string) {
  const labels: Record<string, string> = {
    "case.exception": "Case exception",
    "case.evidence": "Connected evidence",
    "case.deterministicChecks": "Deterministic checks",
    "case.authorityReconciliation": "Authority reconciliation",
    "case.auditHistory": "Case history",
    "case.identity": "Case identity",
    "case.financialPosition": "Financial position",
  };
  return labels[source] ?? source.replaceAll(".", " · ");
}

function RulesView({ mode, onNotify }: { mode: AppMode; onNotify: (message: string) => void }) {
  const controlDefinitions = [
    { name: "AI-assisted receipt extraction", logic: "Receipt text is converted into source-grounded fields", control: "Extraction cannot recognise or close a case", status: "Assistive" },
    { name: "Payment-gap candidate", logic: "Invoice gross less matched payment exceeds configured tolerance", control: "Reviewer confirms applicability", status: "Active" },
    { name: "Beneficiary identity", logic: "Receipt TIN must equal the approved entity master TIN", control: "Exact match required", status: "Active" },
    { name: "Receipt amount", logic: "Expected, receipt and authority amounts are compared separately", control: "Partial states preserved", status: "Active" },
    { name: "External communication", logic: "Drafts use case facts and evidence references only", control: "Human approval required", status: "Enforced" },
  ];
  const [ruleSets, setRuleSets] = useState<Array<{ id: string; version: string; status: string; effective_start: string; practitioner_notes: string; approved_at: string | null }>>([]);
  const [loading, setLoading] = useState(mode === "live");
  const [version, setVersion] = useState("2026.08");
  const [effectiveStart, setEffectiveStart] = useState("2026-08-01");
  const [note, setNote] = useState("");
  const [approvalNote, setApprovalNote] = useState("");

  const load = useCallback(async () => {
    if (mode === "demo") return;
    try {
      const response = await fetch("/api/rules");
      const result = await response.json() as { rules?: typeof ruleSets; error?: string };
      if (!response.ok) throw new Error(result.error || "Rule sets are unavailable");
      setRuleSets(result.rules ?? []);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Rule sets are unavailable"); }
    finally { setLoading(false); }
  }, [mode, onNotify]);

  useEffect(() => {
    if (mode === "demo") return;
    let active = true;
    fetch("/api/rules").then(async (response) => {
      const result = await response.json() as { rules?: typeof ruleSets; error?: string };
      if (!response.ok) throw new Error(result.error || "Rule sets are unavailable");
      if (active) setRuleSets(result.rules ?? []);
    }).catch((error) => onNotify(error instanceof Error ? error.message : "Rule sets are unavailable"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, onNotify]);

  const createRuleSet = async () => {
    if (mode === "demo") { onNotify("Switch to Live workspace to create governed rule sets."); return; }
    try {
      const response = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", version, effectiveStart, amountToleranceKobo: 10_000, applicabilityCategories: ["services", "contracts", "rent", "commission"], note }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Rule set could not be created");
      setNote(""); await load(); onNotify("Draft rule set created. A practitioner must approve it before use.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Rule set could not be created"); }
  };

  const approve = async (ruleSetId: string) => {
    if (approvalNote.trim().length < 10) { onNotify("Approval was not recorded; a rationale of at least 10 characters is required."); return; }
    try {
      const response = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", ruleSetId, note: approvalNote }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Rule set could not be approved");
      setApprovalNote(""); await load(); onNotify("Rule set approved with immutable change history.");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Rule set could not be approved"); }
  };
  const active = ruleSets.find((rule) => rule.status === "approved");

  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <h1>Rules & controls</h1>
          <p>Deterministic controls compare source facts. Practitioner decisions remain visible and accountable.</p>
        </div>
      </section>

      <section className="rule-summary">
        <div>
          <span className="rule-icon"><ShieldCheck size={21} /></span>
          <div><strong>{mode === "demo" ? "Demo rule illustrations" : active ? `Rule set ${active.version}` : "No approved rule set"}</strong><span>{mode === "demo" ? "Synthetic walkthrough only" : active ? `Effective ${active.effective_start} · Approval recorded ${active.approved_at ? new Date(active.approved_at).toLocaleDateString("en-NG") : "in audit history"}` : "Live imports are blocked until a practitioner approves a rule set"}</span></div>
        </div>
        <span className={`stage-badge ${active ? "stage-recognised" : "stage-evidence-needed"}`}>{mode === "demo" ? "Demo" : active ? "Current" : "Action required"}</span>
      </section>

      {mode === "live" && <section className="work-panel rule-editor"><div className="panel-heading"><div><h2>Versioned rule sets</h2><p>Create a draft, then record a separate practitioner approval before it becomes effective.</p></div></div>{loading ? <p>Loading rule sets…</p> : <><div className="rule-form"><label>Version<input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="2026.08" /></label><label>Effective date<input type="date" value={effectiveStart} onChange={(event) => setEffectiveStart(event.target.value)} /></label><label className="rule-note">Change rationale<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain why this rule set is needed" /></label><button className="primary-button" onClick={() => void createRuleSet()} disabled={note.trim().length < 10}>Create draft</button></div>{ruleSets.some((rule) => rule.status === "draft") && <label className="rule-approval-note">Approval rationale<input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Record the basis for practitioner approval" /></label>}<div className="rule-set-history">{ruleSets.map((rule) => <div key={rule.id}><span><strong>{rule.version}</strong><small>Effective {rule.effective_start} · {rule.status}</small></span>{rule.status === "draft" && <button className="secondary-button" onClick={() => void approve(rule.id)} disabled={approvalNote.trim().length < 10}>Review and approve</button>}</div>)}{!ruleSets.length && <p>No governed rule sets have been created in this workspace.</p>}</div></>}</section>}

      <section className="work-panel rule-panel">
        <div className="rule-list">
          {controlDefinitions.map((rule, index) => (
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
  onReviewComplete,
  onNotify,
  onAttachReceipt,
}: {
  recoveryCase: RecoveryCase;
  draftVisible: boolean;
  onBack: () => void;
  onToggleDraft: () => void;
  onCopyDraft: (message?: string, draftId?: string) => void;
  onDownload: () => void;
  onRecognise: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
  onReviewComplete: (effectiveValues: Record<string, string>, outcome: ReviewOutcome) => void;
  onNotify: (message: string) => void;
  onAttachReceipt: () => void;
}) {
  const verifiedCount = recoveryCase.evidence.filter((item) => item.state === "verified").length;
  const allMatched = recoveryCase.checks.every((item) => item.result === "match");
  const receiptEvidence = recoveryCase.evidence.find((item) => item.label === "WHT receipt");
  const authorityEvidence = recoveryCase.evidence.find((item) => item.label === "Authority record");
  const receiptMissing = !receiptEvidence || receiptEvidence.state === "missing" || receiptEvidence.state === "pending";
  const authorityMissing = !authorityEvidence || authorityEvidence.state !== "verified";
  const mandatoryEvidenceComplete = recoveryCase.evidence.length >= 4 && recoveryCase.evidence.every((item) => item.state === "verified");
  const hasExtractedReceipt = Boolean((recoveryCase.sourceDocumentId && !receiptMissing) || receiptEvidence?.state === "verified" || receiptEvidence?.state === "warning");
  const [reviewCompleted, setReviewCompleted] = useState(recoveryCase.stage === "recognised" || recoveryCase.stage === "closed");
  const [assistantLoading, setAssistantLoading] = useState<string | null>(null);
  const [recoveryPlan, setRecoveryPlan] = useState<{ recommendedAction: string; evidenceChecklist: Array<{ item: string; status: string; responsibleParty: string }>; suggestedPriority: string; priorityReasons: string[]; suggestedDueInDays: number; escalationInDays: number; uncertainty: string } | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<{ id?: string; subject: string; body: string; disclaimer: string; sourceLabels: string[] } | null>(null);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const copilotInputRef = useRef<HTMLTextAreaElement>(null);
  const [copilotAnswer, setCopilotAnswer] = useState<{ answer: string; sourceLabels: string[]; limitations: string[]; suggestedAction: string } | null>(null);
  const copilotExamples = [
    "What evidence is missing?",
    "Why is recognition blocked?",
    "What should I do next?",
  ];
  const chooseCopilotExample = (question: string) => {
    setCopilotQuestion(question);
    requestAnimationFrame(() => copilotInputRef.current?.focus());
  };
  const canRecognise = reviewCompleted && allMatched && mandatoryEvidenceComplete;
  const canClose = recoveryCase.stage === "recognised" && mandatoryEvidenceComplete;
  const outstandingRequirements = [
    receiptMissing ? "WHT receipt" : null,
    authorityMissing ? "connected authority record" : null,
    !allMatched ? "resolved field comparisons" : null,
    !reviewCompleted && hasExtractedReceipt ? "completed extraction review" : null,
  ].filter(Boolean) as string[];

  const assistantFacts = {
    caseId: recoveryCase.id,
    customer: recoveryCase.customer,
    invoice: recoveryCase.invoice,
    amount: recoveryCase.amount,
    formattedAmount: formatNaira(recoveryCase.amount),
    age: recoveryCase.age,
    stage: recoveryCase.stage,
    exception: recoveryCase.exception,
    narrative: recoveryCase.narrative,
    nextAction: recoveryCase.nextAction,
    recommendedAction: recoveryCase.nextAction,
    missingEvidence: recoveryCase.evidence.filter((item) => item.state !== "verified").map((item) => item.label),
    outstanding: outstandingRequirements,
    checks: recoveryCase.checks,
    evidence: recoveryCase.evidence,
    draftType: receiptMissing ? "missing_receipt_request" : "evidence_correction_request",
  };
  const runAssistant = async (action: "recovery-plan" | "communication-draft" | "copilot") => {
    setAssistantLoading(action);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          caseId: recoveryCase.id,
          documentId: recoveryCase.sourceDocumentId,
          question: action === "copilot" ? copilotQuestion.trim() : undefined,
          draftType: action === "communication-draft" ? assistantFacts.draftType : undefined,
        }),
      });
      const result = await response.json() as { error?: string; output?: unknown; artifact?: { id: string } | null };
      if (!response.ok || !result.output) throw new Error(result.error || "Assistant output was unavailable");
      if (action === "recovery-plan") setRecoveryPlan(result.output as typeof recoveryPlan);
      if (action === "communication-draft") setGeneratedDraft({ ...(result.output as NonNullable<typeof generatedDraft>), id: result.artifact?.id });
      if (action === "copilot") setCopilotAnswer(result.output as typeof copilotAnswer);
      onNotify(`${action.replaceAll("-", " ")} generated for reviewer consideration.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Assistant output was unavailable");
    } finally {
      setAssistantLoading(null);
    }
  };

  return (
    <div className="case-workspace">
      <div className="case-topline">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> Back to cases</button>
        <div className="case-actions">
          <button className="secondary-button" onClick={onDownload}><Download size={17} /> Export pack</button>
          {receiptMissing ? (
            <button className="primary-button" onClick={onAttachReceipt}><Paperclip size={17} /> Attach WHT receipt</button>
          ) : recoveryCase.stage === "recognised" ? (
            <button className="primary-button" onClick={onClose} disabled={!canClose} title={!canClose ? "Complete all mandatory evidence controls before utilisation" : undefined}><CheckCircle2 size={17} /> Close as utilised</button>
          ) : (
            <button className="secondary-button" onClick={onToggleDraft}><Mail size={17} /> Draft evidence request</button>
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
          <small>{recoveryCase.confidence > 0 ? `${recoveryCase.confidence}% evidence confidence` : "Confidence not assessed"}</small>
        </div>
      </section>

      <section className="case-facts">
        <div><span>Case age</span><strong>{recoveryCase.stage === "closed" ? "Closed" : formatDays(recoveryCase.age)}</strong></div>
        <div><span>Owner</span><strong>{recoveryCase.owner}</strong></div>
        <div><span>Last movement</span><strong>{recoveryCase.updated}</strong></div>
        <div><span>Evidence coverage</span><strong>{verifiedCount} of 4 verified</strong></div>
      </section>

      <div className="case-layout">
        <div className="case-main-column">
          <section className="work-panel evidence-panel">
            <div className="section-heading">
              <div><h2>Evidence position</h2><p>Required records in the recovery control chain.</p></div>
              <span className="confidence-label"><ShieldCheck size={16} /> {recoveryCase.confidence > 0 ? `${recoveryCase.confidence}% confidence` : "Not assessed"}</span>
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

          {hasExtractedReceipt ? (
            <ReviewerCorrectionFlow
              recoveryCase={recoveryCase}
              onReviewStateChange={setReviewCompleted}
              onReviewComplete={onReviewComplete}
              onNotify={onNotify}
            />
          ) : (
            <section className="work-panel correction-empty">
              <span className="document-icon"><FileSearch2 size={18} /></span>
              <div><h2>No extracted receipt to review</h2><p>Attach receipt evidence and complete field extraction before correction or recognition is available.</p></div>
              <button className="secondary-button" onClick={onAttachReceipt}><Paperclip size={17} /> Attach receipt</button>
              <span className="review-state pending"><LockKeyhole size={15} /> Recognition locked</span>
            </section>
          )}

          <section className="work-panel match-panel">
            <div className="section-heading">
              <div><h2>Field comparison</h2><p>Books and evidence compared under the current deterministic rule set.</p></div>
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
                <div><h2>Customer evidence request</h2><p>Grounded draft only. Reviewer approval is required before this text is copied or used.</p></div>
                <button className="icon-button" onClick={onToggleDraft} aria-label="Close draft"><X size={18} /></button>
              </div>
              {generatedDraft ? <>
                <div className="draft-meta"><span>To: Accounts payable, {recoveryCase.customer}</span><span>Case: {recoveryCase.id}</span></div>
                <div className="draft-copy"><strong>Subject: {generatedDraft.subject}</strong>{generatedDraft.body.split("\n").map((line, index) => line ? <p key={index}>{line}</p> : null)}<small>Sources: {generatedDraft.sourceLabels.join(" · ")}</small></div>
                <div className="draft-actions"><span><ShieldCheck size={16} /> {generatedDraft.disclaimer}</span><button className="primary-button" onClick={() => onCopyDraft(`Subject: ${generatedDraft.subject}\n\n${generatedDraft.body}`, generatedDraft.id)}><Check size={17} /> Approve and copy</button></div>
              </> : <div className="assistant-empty"><Quote size={20} /><div><strong>Generate a case-grounded draft</strong><p>The assistant may use only the displayed customer, reference, amount, exception and next action. It cannot send the message.</p></div><button className="primary-button" onClick={() => void runAssistant("communication-draft")} disabled={assistantLoading !== null}>{assistantLoading === "communication-draft" ? <RefreshCw className="spin" size={17} /> : <Mail size={17} />}Generate draft</button></div>}
            </section>
          )}
        </div>

        <aside className="case-side-column">
          <section className="next-action-panel">
            <span className="action-icon"><FileCheck2 size={19} /></span>
            <span className="panel-label">Next required action</span>
            <h2>{recoveryCase.nextAction}</h2>
            <p>This action follows from the incomplete evidence and control checks shown above.</p>
            {receiptMissing ? (
              <button className="primary-button full-button" onClick={onAttachReceipt}><Paperclip size={17} /> Attach WHT receipt</button>
            ) : recoveryCase.stage !== "recognised" && recoveryCase.stage !== "closed" ? (
              <button className="secondary-button full-button" onClick={onToggleDraft}><Mail size={17} /> Prepare request</button>
            ) : null}
            {recoveryCase.stage !== "recognised" && recoveryCase.stage !== "closed" && (
              <button
                className="quiet-button full-button"
                onClick={() => void onRecognise()}
                disabled={!canRecognise}
                title={!canRecognise ? `Complete: ${outstandingRequirements.join(", ")}` : undefined}
              >
                {canRecognise ? <BadgeCheck size={17} /> : <LockKeyhole size={17} />}
                {canRecognise ? "Recognise reviewed credit" : "Recognition locked"}
              </button>
            )}
            {recoveryCase.stage !== "recognised" && recoveryCase.stage !== "closed" && (
              <p className="recognition-gate">
                <ShieldCheck size={15} />
                {canRecognise ? "All mandatory evidence controls have passed." : outstandingRequirements.length ? `Required: ${outstandingRequirements.join(", ")}.` : "Complete all mandatory evidence controls before recognition."}
              </p>
            )}
            {recoveryCase.stage !== "recognised" && recoveryCase.stage !== "closed" && <button className="quiet-button full-button" onClick={() => void runAssistant("recovery-plan")} disabled={assistantLoading !== null}>{assistantLoading === "recovery-plan" ? <RefreshCw className="spin" size={17} /> : <ListFilter size={17} />}Suggest recovery plan</button>}
          </section>

          {recoveryPlan && <section className="case-assistant-panel"><div className="section-heading"><div><h2>Suggested recovery plan</h2><p>Reviewable guidance; no status or owner has changed.</p></div><span className="batch-status processing">{recoveryPlan.suggestedPriority}</span></div><strong>{recoveryPlan.recommendedAction}</strong><div className="plan-checklist">{recoveryPlan.evidenceChecklist.map((item) => <div key={item.item}><span className={`evidence-dot ${item.status}`} /><p><strong>{item.item}</strong><small>{item.responsibleParty.replaceAll("_", " ")}</small></p></div>)}</div><p>Suggested due date: {recoveryPlan.suggestedDueInDays} days · Escalate after {recoveryPlan.escalationInDays} days.</p><small>{recoveryPlan.uncertainty}</small></section>}

          <section className="case-timeline">
            <div className="section-heading"><div><h2>Case history</h2><p>Immutable decisions and material case movements.</p></div><History size={18} /></div>
            <div className="timeline-list">
              {reviewCompleted && <div><span /><p><strong>Extraction review recorded</strong><small>AO · Immutable audit event</small></p></div>}
              <div><span /><p><strong>Match run completed</strong><small>{recoveryCase.updated} · Rules 2026.07</small></p></div>
              <div><span /><p><strong>{recoveryCase.exception}</strong><small>System exception recorded</small></p></div>
              <div><span /><p><strong>Candidate confirmed</strong><small>AO · Reviewer decision</small></p></div>
              <div><span /><p><strong>Case created</strong><small>Imported from July ledger</small></p></div>
            </div>
          </section>

          <section className="case-copilot">
            <div className="section-heading"><div><h2>Case copilot</h2><p>Answers only from this case and its connected controls.</p></div><FileSearch2 size={18} /></div>
            <label><span className="sr-only">Question about this case</span><textarea ref={copilotInputRef} value={copilotQuestion} onChange={(event) => setCopilotQuestion(event.target.value)} placeholder="Ask anything about this case" /></label>
            <div className="copilot-examples" aria-label="Example case questions">
              <span>Try asking</span>
              {copilotExamples.map((question) => <button type="button" key={question} onClick={() => chooseCopilotExample(question)}>{question}</button>)}
            </div>
            <button className="secondary-button full-button" onClick={() => void runAssistant("copilot")} disabled={copilotQuestion.trim().length < 5 || assistantLoading !== null}>{assistantLoading === "copilot" ? <RefreshCw className="spin" size={17} /> : <Search size={17} />}Ask about this case</button>
            {copilotAnswer && <section className="copilot-answer" aria-label="Case copilot answer" aria-live="polite">
              <div className="copilot-answer-heading"><span className="copilot-answer-icon"><Bot size={17} /></span><div><strong>Case answer</strong><small>Grounded in connected case records</small></div></div>
              <p className="copilot-answer-copy">{humaniseCopilotText(copilotAnswer.answer)}</p>
              <div className="copilot-next-step"><ArrowUpRight size={17} /><div><span>Recommended next step</span><strong>{humaniseCopilotText(copilotAnswer.suggestedAction)}</strong></div></div>
              <div className="copilot-sources"><span>Evidence used</span>{copilotAnswer.sourceLabels.length ? <ul>{copilotAnswer.sourceLabels.map((source) => <li key={source}><CheckCircle2 size={14} />{copilotSourceLabel(source)}</li>)}</ul> : <p>No connected case source was used.</p>}</div>
              {copilotAnswer.limitations.length > 0 && <details className="copilot-limitations"><summary><span><ShieldCheck size={15} />Scope and limitations</span><ChevronDown size={15} /></summary><ul>{copilotAnswer.limitations.map((item) => <li key={item}>{humaniseCopilotText(item)}</li>)}</ul></details>}
            </section>}
          </section>
        </aside>
      </div>
    </div>
  );
}

const reviewFieldLabels: Record<string, string> = {
  customer_name: "Customer name",
  beneficiary_tin: "Beneficiary TIN",
  invoice_reference: "Invoice reference",
  receipt_number: "Receipt number",
  wht_amount: "WHT amount (NGN)",
  reporting_period: "Reporting period",
};

function demoReviewData(recoveryCase: RecoveryCase): ReviewData {
  const evidenceReceipt = recoveryCase.evidence.find((item) => item.label === "WHT receipt");
  const byLabel = Object.fromEntries(recoveryCase.checks.map((check) => [check.label, check.evidenceValue]));
  const values: Record<string, string> = {
    customer_name: byLabel.Customer || recoveryCase.customer,
    beneficiary_tin: byLabel["Beneficiary TIN"] === "Not extracted" ? "" : byLabel["Beneficiary TIN"] || "",
    invoice_reference: byLabel["Invoice reference"] === "Not provided" ? "" : recoveryCase.invoice,
    receipt_number: evidenceReceipt?.reference && !["Missing", "Not assessed"].includes(evidenceReceipt.reference) ? evidenceReceipt.reference : "",
    wht_amount: (byLabel["WHT amount"] || formatNaira(recoveryCase.amount)).replace(/[^0-9.]/g, ""),
    reporting_period: byLabel["Reporting period"] === "Unknown" ? "" : byLabel["Reporting period"] || "",
  };
  const quoteByField: Record<string, string> = {
    customer_name: `Deducting customer: ${values.customer_name}`,
    beneficiary_tin: values.beneficiary_tin ? `Beneficiary TIN ${values.beneficiary_tin}` : "No beneficiary TIN located",
    invoice_reference: values.invoice_reference ? `Invoice ${values.invoice_reference}` : "No invoice reference located",
    receipt_number: values.receipt_number ? `Receipt No. ${values.receipt_number}` : "No receipt number located",
    wht_amount: values.wht_amount ? `WHT amount NGN ${values.wht_amount}` : "No WHT amount located",
    reporting_period: values.reporting_period ? `Period ${values.reporting_period}` : "No reporting period located",
  };
  return {
    caseId: recoveryCase.id,
    ruleVersion: "2026.07",
    document: {
      id: "demo-receipt",
      fileName: `${recoveryCase.invoice}-wht-receipt.pdf`,
      sha256: "4eab7f69a37241bbbc9f4c909d8feef4769cc89bd5f560673a118f1349072b91",
      aiModel: "deepseek-v4-flash",
      aiResponseId: "resp_demo_0731",
      createdAt: new Date().toISOString(),
    },
    fields: Object.entries(values).map(([fieldName, value], index) => ({
      id: `demo-${fieldName}`,
      fieldName,
      originalValue: value,
      reviewedValue: null,
      effectiveValue: value,
      confidence: Math.max(58, recoveryCase.confidence - index * 3),
      evidenceQuote: quoteByField[fieldName],
      pageNumber: 1,
      editable: true,
    })),
    review: { completed: recoveryCase.stage === "recognised" || recoveryCase.stage === "closed" },
  };
}

function ReviewerCorrectionFlow({
  recoveryCase,
  onReviewStateChange,
  onReviewComplete,
  onNotify,
}: {
  recoveryCase: RecoveryCase;
  onReviewStateChange: (completed: boolean) => void;
  onReviewComplete: (effectiveValues: Record<string, string>, outcome: ReviewOutcome) => void;
  onNotify: (message: string) => void;
}) {
  const [data, setData] = useState<ReviewData>(() => demoReviewData(recoveryCase));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(data.fields.map((field) => [field.fieldName, field.effectiveValue])));
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(Boolean(recoveryCase.sourceDocumentId));
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(!(recoveryCase.stage === "recognised" || recoveryCase.stage === "closed"));

  useEffect(() => {
    let active = true;
    if (!recoveryCase.sourceDocumentId) return () => { active = false; };
    void fetch(`/api/review?caseId=${encodeURIComponent(recoveryCase.id)}`)
      .then(async (response) => {
        const result = await response.json() as ReviewData & { error?: string };
        if (!response.ok) throw new Error(result.error || "Review data unavailable");
        if (!active) return;
        setData(result);
        setValues(Object.fromEntries(result.fields.map((field) => [field.fieldName, field.effectiveValue])));
        onReviewStateChange(result.review.completed);
      })
      .catch((error) => { if (active) onNotify(error instanceof Error ? error.message : "Review data unavailable"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [recoveryCase.id, recoveryCase.sourceDocumentId, onNotify, onReviewStateChange]);

  const changes = data.fields.filter((field) => (values[field.fieldName] ?? "").trim() !== field.effectiveValue.trim());
  const noteRequired = changes.length > 0;
  const canSubmit = !saving && (!noteRequired || note.trim().length >= 10);

  const localOutcome = (effectiveValues: Record<string, string>): ReviewOutcome => {
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const check = (label: string) => recoveryCase.checks.find((item) => item.label === label);
    const tin = effectiveValues.beneficiary_tin ?? "";
    const invoiceReference = effectiveValues.invoice_reference ?? "";
    const period = effectiveValues.reporting_period ?? "";
    const amount = Number((effectiveValues.wht_amount ?? "").replaceAll(",", ""));
    const invoiceMismatch = Boolean(invoiceReference && normalized(invoiceReference) !== normalized(recoveryCase.invoice));
    const tinMismatch = Boolean(tin && check("Beneficiary TIN") && normalized(check("Beneficiary TIN")!.bookValue) !== normalized(tin));
    const amountMismatch = Number.isFinite(amount) && Math.abs(amount - recoveryCase.amount) > 100;
    const periodMismatch = Boolean(period && check("Reporting period") && normalized(check("Reporting period")!.bookValue) !== normalized(period));
    if (invoiceMismatch) return { stage: "matched", exceptionCode: "INVOICE_MISMATCH", confidence: 68 };
    if (tinMismatch) return { stage: "in-dispute", exceptionCode: "TIN_MISMATCH", confidence: 82 };
    if (amountMismatch) return { stage: "matched", exceptionCode: "AMOUNT_MISMATCH", confidence: 70 };
    if (periodMismatch) return { stage: "matched", exceptionCode: "PERIOD_MISMATCH", confidence: 74 };
    if (!invoiceReference || !tin || !period || !Number.isFinite(amount)) return { stage: "evidence-needed", exceptionCode: "RECEIPT_FIELDS_MISSING", confidence: 58 };
    return { stage: "matched", exceptionCode: "NO_OPEN_EXCEPTION", confidence: 95 };
  };

  const submitReview = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const effectiveValues = { ...Object.fromEntries(data.fields.map((field) => [field.fieldName, field.effectiveValue])), ...values };
    try {
      let outcome: ReviewOutcome;
      let eventId = `demo-${Date.now()}`;
      if (recoveryCase.sourceDocumentId) {
        const corrections = Object.fromEntries(changes.map((field) => [field.fieldName, values[field.fieldName] ?? ""]));
        const response = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId: recoveryCase.id, action: "review-extraction", corrections, note }),
        });
        const result = await response.json() as { error?: string; eventId?: string; outcome?: ReviewOutcome; effectiveValues?: Record<string, string>; reviewedAt?: string };
        if (!response.ok || !result.outcome) throw new Error(result.error || "The extraction review could not be recorded");
        outcome = result.outcome;
        eventId = result.eventId || eventId;
        Object.assign(effectiveValues, result.effectiveValues ?? {});
      } else {
        outcome = localOutcome(effectiveValues);
      }
      const reviewedAt = new Date().toISOString();
      setData((current) => ({
        ...current,
        fields: current.fields.map((field) => ({ ...field, reviewedValue: effectiveValues[field.fieldName], effectiveValue: effectiveValues[field.fieldName] })),
        review: { completed: true, eventId, createdAt: reviewedAt },
      }));
      setValues(effectiveValues);
      setNote("");
      onReviewStateChange(true);
      onReviewComplete(effectiveValues, outcome);
      onNotify(changes.length ? "Corrections audited and deterministic matching rerun" : "Extraction review checkpoint recorded");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "The extraction review could not be recorded");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="work-panel correction-panel">
      <div className="section-heading correction-heading">
        <div>
          <h2>Review extracted receipt</h2>
          <p>Compare source-grounded values, correct permitted fields and record the review checkpoint.</p>
        </div>
        <div className="correction-heading-actions">
          <span className={`review-state ${data.review.completed ? "complete" : "pending"}`}>
            {data.review.completed ? <CheckCircle2 size={15} /> : <LockKeyhole size={15} />}
            {data.review.completed ? "Audit recorded" : "Required before recognition"}
          </span>
          <button className="icon-button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={expanded ? "Collapse extraction review" : "Expand extraction review"}>
            <ChevronRight size={18} className={expanded ? "chevron-open" : ""} />
          </button>
        </div>
      </div>

      {expanded && (loading ? (
        <div className="review-skeleton" aria-label="Loading extraction review">
          {[1, 2, 3].map((item) => <span key={item} />)}
        </div>
      ) : (
        <>
          <div className="source-provenance">
            <span className="document-icon"><FileText size={18} /></span>
            <div><strong>{data.document?.fileName || "Receipt source"}</strong><span>Original retained · SHA-256 {data.document?.sha256.slice(0, 12) || "unavailable"}…</span></div>
            <div><span>Extractor</span><strong>AI-assisted receipt extraction</strong></div>
            <div><span>Rules</span><strong>{data.ruleVersion}</strong></div>
          </div>

          {(data.document?.aiModel || data.document?.aiResponseId) && (
            <details className="audit-technical-details">
              <summary>Audit details</summary>
              <div><span>Provider model</span><strong>{data.document?.aiModel || "Not recorded"}</strong></div>
              <div><span>Response reference</span><strong>{data.document?.aiResponseId || "Not recorded"}</strong></div>
            </details>
          )}

          <div className="correction-legend" aria-hidden="true"><span>Field & source</span><span>Original AI extraction</span><span>Reviewer value</span></div>
          <div className="correction-fields">
            {data.fields.map((field) => {
              const changed = (values[field.fieldName] ?? "").trim() !== field.effectiveValue.trim();
              return (
                <div className={`correction-row ${changed ? "changed" : ""}`} key={field.id}>
                  <div className="field-provenance">
                    <strong>{reviewFieldLabels[field.fieldName] ?? field.fieldName.replaceAll("_", " ")}</strong>
                    <span className={`confidence-chip ${field.confidence < 70 ? "low" : ""}`}>{field.confidence}% confidence</span>
                    <p><Quote size={13} /> “{field.evidenceQuote || "No source snippet returned"}” {field.pageNumber ? <small>p. {field.pageNumber}</small> : null}</p>
                  </div>
                  <div className="original-value"><span>Original</span><strong>{field.originalValue || "Not extracted"}</strong></div>
                  <label className="review-input">
                    <span>Reviewer value {changed && <em>Edited</em>}</span>
                    <div><PencilLine size={15} /><input value={values[field.fieldName] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.fieldName]: event.target.value }))} disabled={!field.editable || saving} aria-label={`Reviewer value for ${reviewFieldLabels[field.fieldName] ?? field.fieldName}`} /></div>
                  </label>
                </div>
              );
            })}
          </div>

          <div className="review-footer">
            <label className="review-note">
              <span>Review note {noteRequired ? <em>Required for {changes.length} correction{changes.length === 1 ? "" : "s"}</em> : <small>Optional when confirming unchanged values</small>}</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={noteRequired ? "Explain why the source supports this correction…" : "Add context for the audit trail…"} aria-describedby="review-note-help" />
              <small id="review-note-help">Stored with before and after values, source provenance, rule outcome, reviewer, and timestamp.</small>
            </label>
            <div className="review-submit">
              <div><ShieldCheck size={16} /><span>Original extraction remains unchanged.</span></div>
              <button className="primary-button" disabled={!canSubmit} onClick={() => void submitReview()}>
                {saving ? <RefreshCw className="spin" size={17} /> : <RefreshCw size={17} />}
                {saving ? "Recording review…" : changes.length ? "Rerun match & record" : "Confirm extraction"}
              </button>
            </div>
          </div>
        </>
      ))}
    </section>
  );
}
