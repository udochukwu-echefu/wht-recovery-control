export const aiTaskTypes = [
  "ledger_mapping",
  "document_classification",
  "receipt_extraction",
  "candidate_ranking",
  "exception_explanation",
  "recovery_plan",
  "communication_draft",
  "evidence_summary",
  "portfolio_briefing",
  "case_copilot",
] as const;

export type AiTaskType = typeof aiTaskTypes[number];
export type AiTaskStatus = "queued" | "processing" | "completed" | "failed" | "manual_review";
export type SourceReference = { type: "case_field" | "document" | "audit_event" | "aggregate" | "rule"; id: string; label: string };

export type AiTaskDefinition<TInput, TOutput> = {
  type: AiTaskType;
  promptVersion: string;
  systemPrompt: string;
  validateOutput: (value: unknown, input: TInput) => TOutput;
  demoOutput: (input: TInput) => TOutput;
  confidence: (output: TOutput) => number;
  sourceReferences: (input: TInput, output: TOutput) => SourceReference[];
};

export type AiTaskResult<TOutput> = {
  jobId: string;
  status: "completed" | "manual_review";
  provider: string;
  model: string;
  promptVersion: string;
  output: TOutput | null;
  confidence: number | null;
  sourceReferences: SourceReference[];
  latencyMs: number;
  validationOutcome: "validated" | "manual_review";
  safeMessage?: string;
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<TInput, TOutput>(
    task: AiTaskDefinition<TInput, TOutput>,
    input: TInput,
  ): Promise<{ output: unknown; responseId?: string }>;
}

export type LedgerTargetField =
  | "customer_name"
  | "customer_tin"
  | "invoice_reference"
  | "invoice_gross_amount"
  | "payment_net_amount"
  | "payment_date"
  | "reporting_period"
  | "expected_wht_amount"
  | "currency"
  | "entity_reference"
  | "unmapped";

export const ledgerTargetFields: LedgerTargetField[] = [
  "customer_name", "customer_tin", "invoice_reference", "invoice_gross_amount",
  "payment_net_amount", "payment_date", "reporting_period", "expected_wht_amount",
  "currency", "entity_reference", "unmapped",
];

export type LedgerMappingOutput = {
  mappings: Array<{ sourceColumn: string; targetField: LedgerTargetField; confidence: number; reason: string }>;
  detectedDateFormat: string;
  detectedCurrency: string;
  warnings: Array<{ severity: "info" | "warning" | "error"; column: string; message: string; affectedRows: number[] }>;
  unmappedColumns: string[];
  overallConfidence: number;
};

export type DocumentType = "wht_receipt" | "deduction_certificate" | "remittance_advice" | "authority_record" | "customer_correspondence" | "invoice" | "payment_evidence" | "unknown";
export type DocumentClassificationOutput = {
  documentType: DocumentType;
  confidence: number;
  explanation: string;
  detectedPageCount: number | null;
  ocrRequired: boolean;
  appearsIncomplete: boolean;
  potentialDuplicate: boolean;
};

export type ExtractedReceiptField = {
  fieldName: string;
  value: string;
  normalisedValue: string;
  confidence: number;
  sourceQuote: string;
  pageNumber: number | null;
  boundingBox: null;
  warnings: string[];
};

export type ReceiptExtractionOutput = { fields: ExtractedReceiptField[]; overallConfidence: number; untrustedInstructionsDetected: boolean };
export type CandidateRankingOutput = {
  candidates: Array<{ caseId: string; rank: number; confidence: number; reasons: string[]; conflicts: string[] }>;
  recommendation: "review_top_candidate" | "manual_review" | "unresolved";
  uncertainty: string;
};
export type ExceptionExplanationOutput = {
  exceptionCode: string;
  plainLanguageSummary: string;
  likelyCauses: string[];
  responsibleParty: "deducting_customer" | "internal" | "unknown";
  requiredEvidence: string[];
  recommendedNextAction: string;
  limitations: string[];
};
export type RecoveryPlanOutput = {
  caseId: string;
  recommendedAction: string;
  evidenceChecklist: Array<{ item: string; status: "complete" | "missing" | "pending"; responsibleParty: "deducting_customer" | "internal" | "authority" }>;
  suggestedOwnerRole: string;
  suggestedPriority: "urgent" | "high" | "standard" | "practitioner-sensitive";
  priorityReasons: string[];
  suggestedDueInDays: number;
  escalationInDays: number;
  expectedNextStatus: "evidence-needed" | "matched" | "in-dispute";
  practitionerQuestions: string[];
  uncertainty: string;
  draftCommunicationType: string;
};
export type CommunicationDraftOutput = { draftType: string; subject: string; body: string; sourceLabels: string[]; disclaimer: string };
export type EvidenceSummaryOutput = { executiveSummary: string; exceptionNarrative: string; correspondenceSummary: string; resolutionHistory: string; outstandingItemsSummary: string; sourceLabels: string[] };
export type PortfolioBriefingOutput = { narrative: string; statements: Array<{ text: string; filter: string; caseIds: string[] }>; dataQualityWarning: string; sourceLabels: string[] };
export type CaseCopilotOutput = { answer: string; sourceLabels: string[]; limitations: string[]; suggestedAction: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`${label} contains unknown field ${unknown}.`);
  const missing = keys.find((key) => !(key in value));
  if (missing) throw new Error(`${label} is missing ${missing}.`);
}

export function boundedConfidence(value: unknown, label = "confidence") {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} must be between 0 and 100.`);
  return Math.round(value);
}

export function stringValue(value: unknown, label: string, max = 2_000) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  return value.trim().slice(0, max);
}

export function stringArray(value: unknown, label: string, maxItems = 20) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a text array.`);
  return value.slice(0, maxItems).map((item) => item.trim().slice(0, 500));
}
