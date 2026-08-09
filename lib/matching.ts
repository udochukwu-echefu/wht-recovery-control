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
  const amountMissing = receipt.whtAmountKobo === null;
  const tinMissing = !receipt.beneficiaryTin;
  const periodMissing = !receipt.reportingPeriod;
  const tinMismatch = Boolean(candidate.customerTin && receipt.beneficiaryTin && normalize(candidate.customerTin) !== normalize(receipt.beneficiaryTin));
  const amountMismatch = receipt.whtAmountKobo !== null && Math.abs(receipt.whtAmountKobo - candidate.expectedWhtKobo) > 10000;
  const periodMismatch = Boolean(candidate.reportingPeriod && receipt.reportingPeriod && normalize(candidate.reportingPeriod) !== normalize(receipt.reportingPeriod));

  if (tinMismatch) return { stage: "in-dispute", exceptionCode: "TIN_MISMATCH", confidence: 82 };
  if (amountMismatch) return { stage: "matched", exceptionCode: "AMOUNT_MISMATCH", confidence: 70 };
  if (periodMismatch) return { stage: "matched", exceptionCode: "PERIOD_MISMATCH", confidence: 74 };
  if (amountMissing || tinMissing || periodMissing) return { stage: "evidence-needed", exceptionCode: "RECEIPT_FIELDS_MISSING", confidence: 58 };
  return { stage: "matched", exceptionCode: "NO_OPEN_EXCEPTION", confidence: 95 };
}
