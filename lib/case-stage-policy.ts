export const recoveryCaseStages = [
  "detected",
  "evidence-needed",
  "matched",
  "in-dispute",
  "recognised",
  "closed",
  "non-recoverable",
  "written-off",
] as const;

export type RecoveryCaseStage = (typeof recoveryCaseStages)[number];
export type RecoveryCaseStageProjection = RecoveryCaseStage | "invalid";
export type ReviewerStageAction = "review-extraction" | "recognise";
export type CaseOutcomeType = "utilised" | "written_off" | "non_recoverable" | "closed_no_value";

type MatchExceptionCode =
  | "INVOICE_MISMATCH"
  | "DEDUCTOR_TIN_MISMATCH"
  | "BENEFICIARY_TIN_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "PERIOD_MISMATCH"
  | "RECEIPT_FIELDS_MISSING"
  | "NO_OPEN_EXCEPTION";

const stageDefinitions: Record<RecoveryCaseStageProjection, { label: string; terminal: boolean; defaultNextAction: string | null }> = {
  detected: { label: "Detected", terminal: false, defaultNextAction: "Confirm WHT applicability and deduction basis" },
  "evidence-needed": { label: "Evidence needed", terminal: false, defaultNextAction: "Attach or complete the required WHT evidence" },
  matched: { label: "Partial match", terminal: false, defaultNextAction: "Complete authority reconciliation and reviewer checks" },
  "in-dispute": { label: "In dispute", terminal: false, defaultNextAction: "Resolve the deterministic evidence exception" },
  recognised: { label: "Recognised", terminal: false, defaultNextAction: "Record utilisation when applied" },
  closed: { label: "Closed", terminal: true, defaultNextAction: null },
  "non-recoverable": { label: "Non-recoverable", terminal: true, defaultNextAction: null },
  "written-off": { label: "Written off", terminal: true, defaultNextAction: null },
  invalid: { label: "Invalid case state", terminal: true, defaultNextAction: "Contact the workspace administrator to repair this case state" },
};

export const machineMutableRecoveryCaseStages = ["detected", "evidence-needed", "matched", "in-dispute"] as const satisfies readonly RecoveryCaseStage[];
const machineOutcomeStages = new Set<RecoveryCaseStage>(machineMutableRecoveryCaseStages);
const machineLockedStages = new Set<RecoveryCaseStage>(["recognised", "closed", "non-recoverable", "written-off"]);

const matchOutcomes: Record<MatchExceptionCode, { stage: RecoveryCaseStage; confidence: number }> = {
  INVOICE_MISMATCH: { stage: "matched", confidence: 68 },
  DEDUCTOR_TIN_MISMATCH: { stage: "in-dispute", confidence: 82 },
  BENEFICIARY_TIN_MISMATCH: { stage: "in-dispute", confidence: 82 },
  AMOUNT_MISMATCH: { stage: "matched", confidence: 70 },
  PERIOD_MISMATCH: { stage: "matched", confidence: 74 },
  RECEIPT_FIELDS_MISSING: { stage: "evidence-needed", confidence: 58 },
  NO_OPEN_EXCEPTION: { stage: "matched", confidence: 95 },
};

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

export class CaseStagePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseStagePolicyError";
  }
}

export function isRecoveryCaseStage(value: unknown): value is RecoveryCaseStage {
  return typeof value === "string" && recoveryCaseStages.includes(value as RecoveryCaseStage);
}

export function isMachineOutcomeStage(value: unknown): value is (typeof machineMutableRecoveryCaseStages)[number] {
  return typeof value === "string" && machineOutcomeStages.has(value as RecoveryCaseStage);
}

export function requireRecoveryCaseStage(value: unknown): RecoveryCaseStage {
  if (!isRecoveryCaseStage(value)) throw new CaseStagePolicyError(`Unknown recovery-case stage: ${String(value || "empty")}.`);
  return value;
}

export function projectRecoveryCaseStage(value: unknown): RecoveryCaseStageProjection {
  return isRecoveryCaseStage(value) ? value : "invalid";
}

export function recoveryCaseStageLabel(stage: RecoveryCaseStageProjection) {
  return stageDefinitions[stage].label;
}

export function recoveryCaseExceptionLabel(exceptionCode: string) {
  return exceptionLabels[exceptionCode] ?? exceptionCode.replaceAll("_", " ").toLowerCase();
}

export function isTerminalRecoveryCaseStage(stage: RecoveryCaseStageProjection) {
  return stageDefinitions[stage].terminal;
}

export function nextActionForRecoveryCase(input: { stage: RecoveryCaseStageProjection; exceptionCode?: string | null; authorityConnected?: boolean; hasReceipt?: boolean }) {
  if (input.stage === "invalid") return stageDefinitions.invalid.defaultNextAction;
  if (input.stage === "matched" && input.exceptionCode === "NO_OPEN_EXCEPTION") {
    return input.authorityConnected ? "Review and recognise credit" : "Connect and verify the authority record";
  }
  if (input.stage === "in-dispute" && input.exceptionCode === "AUTHORITY_MISMATCH") return "Resolve authority mismatch";
  if (input.stage === "in-dispute") return "Request corrected evidence and rerun deterministic matching";
  if (input.stage === "evidence-needed" && !input.hasReceipt) return "Attach WHT receipt";
  return stageDefinitions[input.stage].defaultNextAction;
}

export function matchOutcomeForException(exceptionCode: MatchExceptionCode) {
  return { ...matchOutcomes[exceptionCode], exceptionCode };
}

export function assertMachineOutcomeTransition(currentValue: unknown, nextValue: unknown) {
  const current = requireRecoveryCaseStage(currentValue);
  const next = requireRecoveryCaseStage(nextValue);
  if (machineLockedStages.has(current)) throw new CaseStagePolicyError(`${recoveryCaseStageLabel(current)} cases cannot be changed by deterministic matching.`);
  if (!machineOutcomeStages.has(next)) throw new CaseStagePolicyError(`Deterministic matching cannot set the case stage to ${recoveryCaseStageLabel(next)}.`);
  return next;
}

export function reviewerStageTransition(currentValue: unknown, action: ReviewerStageAction): RecoveryCaseStage {
  const current = requireRecoveryCaseStage(currentValue);
  if (action === "review-extraction") {
    if (machineLockedStages.has(current)) throw new CaseStagePolicyError(`${recoveryCaseStageLabel(current)} cases cannot receive a new extraction review.`);
    return current;
  }
  if (action === "recognise") {
    if (current !== "matched") throw new CaseStagePolicyError("Only a deterministically matched case can be recognised.");
    return "recognised";
  }
  throw new CaseStagePolicyError(`Unsupported reviewer stage action: ${String(action)}.`);
}

export function stageForApplicabilityOutcome(outcome: "applicable" | "not_applicable" | "exempt" | "uncertain"): RecoveryCaseStage {
  if (outcome === "applicable") return "evidence-needed";
  if (outcome === "uncertain") return "detected";
  return "non-recoverable";
}

export function stageForRecordedOutcome(currentValue: unknown, outcome: CaseOutcomeType): RecoveryCaseStage {
  const current = requireRecoveryCaseStage(currentValue);
  if (isTerminalRecoveryCaseStage(current)) throw new CaseStagePolicyError(`${recoveryCaseStageLabel(current)} cases already have a terminal outcome.`);
  if (outcome === "utilised") {
    if (current !== "recognised") throw new CaseStagePolicyError("Only a recognised case can be closed as utilised.");
    return "closed";
  }
  if (current === "recognised") throw new CaseStagePolicyError("A recognised credit can only progress to a recorded utilisation closure.");
  if (outcome === "closed_no_value") return "closed";
  if (outcome === "written_off") return "written-off";
  return "non-recoverable";
}
