import { type PersistentCase, type RecoveryCase } from "./types";
import {
  projectRecoveryCaseStage,
  recoveryCaseExceptionLabel,
  nextActionForRecoveryCase,
} from "@/lib/case-stage-policy";

const nairaFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

export const formatNaira = (value: number) =>
  nairaFormatter.format(value).replace("NGN", "₦");

export const formatDays = (days: number) =>
  days === 1 ? "1 day" : `${days} days`;

export function persistentCaseToView(item: PersistentCase): RecoveryCase {
  const amount = item.expectedWhtKobo / 100;
  const receiptAmount =
    item.receiptAmountKobo === null ? null : item.receiptAmountKobo / 100;
  const hasReceipt = Boolean(item.receiptNumber && receiptAmount !== null);
  const stage = projectRecoveryCaseStage(item.stage);
  const exceptionCode = item.exceptionCode;
  const amountMatches =
    receiptAmount !== null && Math.abs(receiptAmount - amount) <= 100;
  const tinMatches = Boolean(
    item.clientTin &&
    item.receiptBeneficiaryTin &&
    item.clientTin.replace(/\W/g, "") ===
      item.receiptBeneficiaryTin.replace(/\W/g, ""),
  );
  const authorityConnected = Boolean(item.authorityConnected);
  return {
    id: item.id,
    customer: item.customer,
    invoice: item.invoiceReference,
    amount,
    stage,
    exception: recoveryCaseExceptionLabel(exceptionCode),
    age: Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(item.updatedAt).getTime()) / 86_400_000,
      ),
    ),
    owner: item.assignedOwnerId || "Unassigned",
    confidence: item.confidence,
    updated: new Date(item.updatedAt).toLocaleString("en-NG", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    nextAction:
      item.nextAction ||
      nextActionForRecoveryCase({
        stage,
        exceptionCode,
        authorityConnected,
        hasReceipt,
      }) ||
      "No further action",
    narrative: hasReceipt
      ? "Receipt fields were extracted and compared with the ledger candidate. The authority record must be connected before recognition."
      : "The ledger payment gap created this candidate. A WHT receipt is required before matching can continue.",
    evidence: [
      {
        label: "Invoice",
        reference: item.invoiceReference,
        detail: formatNaira(item.invoiceGrossKobo / 100),
        state: "verified",
      },
      {
        label: "Payment",
        reference: "Imported ledger",
        detail: formatNaira(item.paymentNetKobo / 100),
        state: "verified",
      },
      {
        label: "WHT receipt",
        reference: item.receiptNumber || "Missing",
        detail:
          receiptAmount === null
            ? "Attachment required"
            : formatNaira(receiptAmount),
        state: hasReceipt
          ? item.exceptionCode === "NO_OPEN_EXCEPTION"
            ? "verified"
            : "warning"
          : "missing",
      },
      {
        label: "Authority record",
        reference: authorityConnected
          ? "Verified authority allocation"
          : "Not connected",
        detail: authorityConnected
          ? "Deterministic reconciliation passed"
          : "Required before recognition",
        state: authorityConnected ? "verified" : "missing",
      },
    ],
    checks: [
      {
        label: "Invoice reference",
        bookValue: item.invoiceReference,
        evidenceValue: item.receiptNumber
          ? item.invoiceReference
          : "Not provided",
        result: item.receiptNumber ? "match" : "missing",
      },
      {
        label: "Beneficiary TIN",
        bookValue: item.clientTin || "Entity TIN not configured",
        evidenceValue: item.receiptBeneficiaryTin || "Not extracted",
        result:
          !item.receiptBeneficiaryTin || !item.clientTin
            ? "missing"
            : tinMatches
              ? "match"
              : "mismatch",
      },
      {
        label: "WHT amount",
        bookValue: formatNaira(amount),
        evidenceValue:
          receiptAmount === null ? "Not extracted" : formatNaira(receiptAmount),
        result:
          receiptAmount === null
            ? "missing"
            : amountMatches
              ? "match"
              : "mismatch",
      },
      {
        label: "Reporting period",
        bookValue: item.reportingPeriod || "Not provided",
        evidenceValue: item.reportingPeriod || "Not extracted",
        result: item.reportingPeriod ? "match" : "missing",
      },
    ],
    sourceDocumentId: item.sourceDocumentId,
  };
}

export function humaniseCopilotText(value: string) {
  return value.replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, (code) =>
    code.toLowerCase().replaceAll("_", " "),
  );
}

export function copilotSourceLabel(source: string) {
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
