import test from "node:test";
import assert from "node:assert/strict";
import { parsePortfolioToolArguments } from "../lib/ai/agent-tool-contracts.ts";
import { followupTime, validateActionPayload } from "../lib/ai/action-contracts.ts";
import { persistentCaseToView } from "../features/recovery/presentation.ts";

test("proposal tools reject invalid dates, hidden status effects and ambiguous follow-up timing", () => {
  assert.throws(() => parsePortfolioToolArguments("propose_case_due_date", '{"caseId":"CASE-A","dueDate":"2026-02-30"}'), /calendar date/);
  assert.throws(() => parsePortfolioToolArguments("propose_scheduled_followup", '{"caseId":"CASE-A","runAt":"2026-11-01T09:00:00","question":"Inspect evidence"}'), /timezone/);
  assert.throws(() => parsePortfolioToolArguments("propose_case_priority", '{"caseId":"CASE-A","priority":"high","stage":"recognised"}'), /unsupported/);
  assert.throws(() => validateActionPayload("case_note", { body: "Exact note for review.", approved: true }), /unsupported/);
  assert.throws(() => validateActionPayload("case_priority", { priority: ["high"] }), /invalid/);
  assert.throws(() => validateActionPayload("case_assignment", { ownerId: "reviewer", ownerName: "Synthetic Reviewer", ownerRole: ["reviewer"] }), /invalid/);
  assert.throws(() => validateActionPayload("recognise_case", {}), /unsupported/);
  assert.deepEqual(parsePortfolioToolArguments("propose_case_due_date", '{"caseId":"CASE-A","dueDate":null}'), { caseId: "CASE-A", dueDate: null });
});

test("follow-up timing preserves Nigeria's offset and enforces a future 90-day horizon", () => {
  const now = Date.parse("2026-10-09T08:00:00.000Z");
  assert.equal(followupTime("2026-10-10T09:00:00+01:00", true, now), "2026-10-10T08:00:00.000Z");
  assert.throws(() => followupTime("2026-10-09T08:00:00Z", true, now), /future/);
  assert.throws(() => followupTime("2027-05-01T08:00:00Z", true, now), /90 days/);
});

test("case coordination updates do not reset recovery ageing", () => {
  const createdAt = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const caseFacts = { id: "CASE-A", customer: "Synthetic Acme", customerTin: "TEST-TIN", invoiceReference: "SYNTH-1", invoiceGrossKobo: 10000000, paymentNetKobo: 9500000, expectedWhtKobo: 500000, reportingPeriod: "Jul 2026", receiptNumber: null, receiptAmountKobo: null, receiptBeneficiaryTin: null, stage: "evidence-needed", exceptionCode: "RECEIPT_MISSING", confidence: 50, sourceDocumentId: null, createdAt, updatedAt: createdAt };
  assert.equal(persistentCaseToView({ ...caseFacts, updatedAt: new Date().toISOString(), assignedOwnerId: "reviewer" }).age, persistentCaseToView(caseFacts).age);
  assert.ok(persistentCaseToView(caseFacts).age >= 90);
});
