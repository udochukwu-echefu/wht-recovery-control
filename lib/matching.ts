export type ReceiptExtraction = {
  customerName: string;
  beneficiaryTin: string;
  invoiceReference: string;
  receiptNumber: string;
  whtAmountKobo: number | null;
  reportingPeriod: string;
  fields: Record<string, { confidence: number; evidenceQuote: string; pageNumber: number | null }>;
};

export type CandidateCase = {
  id: string;
  customer: string;
  customerTin: string;
  invoiceReference: string;
  expectedWhtKobo: number;
  reportingPeriod: string;
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export type CandidateFactor = {
  caseId: string;
  factors: { score: number; reasons: string[]; conflicts: string[] };
};

export function buildCandidateFactors(receipt: ReceiptExtraction, cases: CandidateCase[]): CandidateFactor[] {
  return cases.map((candidate) => {
    let score = 0;
    const reasons: string[] = [];
    const conflicts: string[] = [];
    const compare = (label: string, supplied: string, expected: string, weight: number) => {
      if (!supplied || !expected) return;
      if (normalize(supplied) === normalize(expected)) { score += weight; reasons.push(`${label} agrees`); }
      else conflicts.push(`${label} differs`);
    };
    compare("Invoice reference", receipt.invoiceReference, candidate.invoiceReference, 55);
    compare("Customer name", receipt.customerName, candidate.customer, 15);
    compare("Reporting period", receipt.reportingPeriod, candidate.reportingPeriod, 10);
    if (receipt.whtAmountKobo !== null) {
      const difference = Math.abs(receipt.whtAmountKobo - candidate.expectedWhtKobo);
      if (difference <= 10_000) { score += 20; reasons.push("WHT amount is within ₦100 tolerance"); }
      else conflicts.push(`WHT amount differs by ₦${(difference / 100).toLocaleString("en-NG")}`);
    }
    return { caseId: candidate.id, factors: { score, reasons, conflicts } };
  }).sort((left, right) => right.factors.score - left.factors.score);
}

export function chooseReceiptCandidate(receipt: ReceiptExtraction, cases: CandidateCase[]) {
  const ranked = cases.map((candidate) => {
    let score = 0;
    if (receipt.invoiceReference && normalize(receipt.invoiceReference) === normalize(candidate.invoiceReference)) score += 60;
    if (receipt.customerName && normalize(receipt.customerName) === normalize(candidate.customer)) score += 20;
    if (receipt.whtAmountKobo !== null && Math.abs(receipt.whtAmountKobo - candidate.expectedWhtKobo) <= 10000) score += 15;
    if (receipt.reportingPeriod && normalize(receipt.reportingPeriod) === normalize(candidate.reportingPeriod)) score += 5;
    return { candidate, score };
  }).sort((left, right) => right.score - left.score);
  return ranked[0] && ranked[0].score >= 60 ? ranked[0] : null;
}

export function evaluateReceiptMatch(receipt: ReceiptExtraction, candidate: CandidateCase) {
  const invoiceMissing = !receipt.invoiceReference;
  const amountMissing = receipt.whtAmountKobo === null;
  const tinMissing = !receipt.beneficiaryTin;
  const periodMissing = !receipt.reportingPeriod;
  const invoiceMismatch = Boolean(receipt.invoiceReference && normalize(candidate.invoiceReference) !== normalize(receipt.invoiceReference));
  const tinMismatch = Boolean(candidate.customerTin && receipt.beneficiaryTin && normalize(candidate.customerTin) !== normalize(receipt.beneficiaryTin));
  const amountMismatch = receipt.whtAmountKobo !== null && Math.abs(receipt.whtAmountKobo - candidate.expectedWhtKobo) > 10000;
  const periodMismatch = Boolean(candidate.reportingPeriod && receipt.reportingPeriod && normalize(candidate.reportingPeriod) !== normalize(receipt.reportingPeriod));

  if (invoiceMismatch) return { stage: "matched", exceptionCode: "INVOICE_MISMATCH", confidence: 68 };
  if (tinMismatch) return { stage: "in-dispute", exceptionCode: "TIN_MISMATCH", confidence: 82 };
  if (amountMismatch) return { stage: "matched", exceptionCode: "AMOUNT_MISMATCH", confidence: 70 };
  if (periodMismatch) return { stage: "matched", exceptionCode: "PERIOD_MISMATCH", confidence: 74 };
  if (invoiceMissing || amountMissing || tinMissing || periodMissing) return { stage: "evidence-needed", exceptionCode: "RECEIPT_FIELDS_MISSING", confidence: 58 };
  return { stage: "matched", exceptionCode: "NO_OPEN_EXCEPTION", confidence: 95 };
}

export function evaluateReceiptMatchDetailed(receipt: ReceiptExtraction, candidate: CandidateCase) {
  const result = evaluateReceiptMatch(receipt, candidate);
  const checks = [
    { ruleId: "WHT-R01", label: "Invoice reference", input: { ledger: candidate.invoiceReference, receipt: receipt.invoiceReference }, tolerance: "Exact after punctuation normalisation", outcome: !receipt.invoiceReference ? "missing" : normalize(candidate.invoiceReference) === normalize(receipt.invoiceReference) ? "pass" : "fail" },
    { ruleId: "WHT-R02", label: "Beneficiary TIN", input: { ledger: candidate.customerTin, receipt: receipt.beneficiaryTin }, tolerance: "Exact after punctuation normalisation", outcome: !receipt.beneficiaryTin ? "missing" : !candidate.customerTin || normalize(candidate.customerTin) === normalize(receipt.beneficiaryTin) ? "pass" : "fail" },
    { ruleId: "WHT-R03", label: "Expected WHT amount", input: { ledgerKobo: candidate.expectedWhtKobo, receiptKobo: receipt.whtAmountKobo }, tolerance: "±10,000 kobo (₦100)", outcome: receipt.whtAmountKobo === null ? "missing" : Math.abs(receipt.whtAmountKobo - candidate.expectedWhtKobo) <= 10_000 ? "pass" : "fail" },
    { ruleId: "WHT-R04", label: "Reporting period", input: { ledger: candidate.reportingPeriod, receipt: receipt.reportingPeriod }, tolerance: "Exact after punctuation normalisation", outcome: !receipt.reportingPeriod ? "missing" : !candidate.reportingPeriod || normalize(candidate.reportingPeriod) === normalize(receipt.reportingPeriod) ? "pass" : "fail" },
  ];
  return { ...result, ruleVersion: "2026.07", checks };
}
