import type { LedgerTargetField } from "@/lib/ledger-fields";
export type { LedgerTargetField } from "@/lib/ledger-fields";
import {
  type RecoveryCaseStageProjection,
  type RecoveryCaseStage,
} from "@/lib/case-stage-policy";

export type CaseStage = RecoveryCaseStageProjection;

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

export type RecoveryCase = {
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

export type View =
  "overview" | "cases" | "imports" | "rules" | "ai-activity" | "settings";

export type CaseFilter = CaseStage | "all" | "open" | "needs-intervention";

export type AiStatus = {
  configured: boolean;
  model: string;
  provider?: string;
  release?: string;
  demoFallback?: boolean;
};

export type AppMode = "demo" | "live";

export type SessionInfo = {
  user: { displayName: string; email: string };
  workspace: { id: string; name: string; role: string };
  clientId: string;
  localDevelopment: boolean;
};

export type LedgerMappingItem = {
  sourceColumn: string;
  targetField: LedgerTargetField;
  confidence?: number;
  reason?: string;
};

export type LedgerValidation = {
  valid: boolean;
  validRows: number;
  rejectedRows: number;
  errors: string[];
  warnings: string[];
  deterministicCalculation?: string;
};

type LedgerWarning =
  | string
  | {
      severity: string;
      column: string;
      message: string;
      affectedRows: number[];
    };

export type LedgerWorkflow = {
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
  ai: {
    status: string;
    provider: string;
    model: string;
    promptVersion: string;
    jobId: string;
    safeMessage?: string;
  };
  validation?: LedgerValidation;
};

export type EvidenceWorkflow = {
  kind: "evidence";
  documentId: string;
  classification: {
    documentType: string;
    confidence: number;
    explanation: string;
    ocrRequired: boolean;
    appearsIncomplete: boolean;
    potentialDuplicate: boolean;
  };
  duplicate: { id?: string; fileName?: string; createdAt?: string } | null;
  extraction: {
    fields: Array<{
      fieldName: string;
      value: string;
      normalisedValue: string;
      confidence: number;
      sourceQuote: string;
      pageNumber: number | null;
      warnings: string[];
    }>;
    overallConfidence: number;
    untrustedInstructionsDetected: boolean;
  } | null;
  candidates: Array<{
    caseId: string;
    rank: number;
    confidence: number;
    reasons: string[];
    conflicts: string[];
    case?: {
      customer: string;
      invoiceReference: string;
      expectedWhtKobo: number;
      reportingPeriod: string;
    };
  }>;
  recommendation: string;
  uncertainty: string;
  untrustedInstructionsDetected?: boolean;
};

export type PersistentCase = {
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

export type ReviewData = {
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

export type ReviewOutcome = {
  stage: RecoveryCaseStage;
  exceptionCode: string;
  confidence: number;
};

export type EvidenceSummary = {
  executiveSummary: string;
  exceptionNarrative: string;
  correspondenceSummary: string;
  resolutionHistory: string;
  outstandingItemsSummary: string;
  sourceLabels: string[];
};
