import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseStagePolicyError,
  assertMachineOutcomeTransition,
  isTerminalRecoveryCaseStage,
  matchOutcomeForException,
  nextActionForRecoveryCase,
  projectRecoveryCaseStage,
  reviewerStageTransition,
  stageForApplicabilityOutcome,
  stageForRecordedOutcome,
} from "../lib/case-stage-policy.ts";

test("deterministic match exceptions resolve through one stage policy", () => {
  assert.deepEqual(matchOutcomeForException("NO_OPEN_EXCEPTION"), { stage: "matched", confidence: 95, exceptionCode: "NO_OPEN_EXCEPTION" });
  assert.deepEqual(matchOutcomeForException("RECEIPT_FIELDS_MISSING"), { stage: "evidence-needed", confidence: 58, exceptionCode: "RECEIPT_FIELDS_MISSING" });
  assert.deepEqual(matchOutcomeForException("BENEFICIARY_TIN_MISMATCH"), { stage: "in-dispute", confidence: 82, exceptionCode: "BENEFICIARY_TIN_MISMATCH" });
});

test("machine outcomes cannot rewrite recognised or terminal cases", () => {
  assert.equal(assertMachineOutcomeTransition("detected", "evidence-needed"), "evidence-needed");
  assert.throws(() => assertMachineOutcomeTransition("recognised", "matched"), CaseStagePolicyError);
  assert.throws(() => assertMachineOutcomeTransition("closed", "in-dispute"), CaseStagePolicyError);
  assert.throws(() => assertMachineOutcomeTransition("matched", "recognised"), CaseStagePolicyError);
});

test("reviewer progression prevents impossible stage jumps", () => {
  assert.equal(reviewerStageTransition("matched", "recognise"), "recognised");
  assert.throws(() => reviewerStageTransition("detected", "recognise"), /Only a deterministically matched case/);
  assert.throws(() => reviewerStageTransition("written-off", "review-extraction"), /cannot receive a new extraction review/);
});

test("unknown stored stages are explicit and fail safe", () => {
  assert.equal(projectRecoveryCaseStage("legacy-complete"), "invalid");
  assert.equal(isTerminalRecoveryCaseStage("invalid"), true);
  assert.match(nextActionForRecoveryCase({ stage: "invalid" }) ?? "", /administrator/);
});

test("applicability and recorded outcomes share terminal policy", () => {
  assert.equal(stageForApplicabilityOutcome("applicable"), "evidence-needed");
  assert.equal(stageForApplicabilityOutcome("uncertain"), "detected");
  assert.equal(stageForApplicabilityOutcome("exempt"), "non-recoverable");
  assert.equal(stageForRecordedOutcome("recognised", "utilised"), "closed");
  assert.equal(stageForRecordedOutcome("matched", "written_off"), "written-off");
  assert.throws(() => stageForRecordedOutcome("recognised", "written_off"), /only progress to a recorded utilisation/);
  assert.throws(() => stageForRecordedOutcome("closed", "non_recoverable"), /terminal outcome/);
});

test("next actions are derived from stage and control context", () => {
  assert.equal(nextActionForRecoveryCase({ stage: "evidence-needed", exceptionCode: "RECEIPT_MISSING", hasReceipt: false }), "Attach WHT receipt");
  assert.equal(nextActionForRecoveryCase({ stage: "matched", exceptionCode: "NO_OPEN_EXCEPTION", authorityConnected: false, hasReceipt: true }), "Connect and verify the authority record");
  assert.equal(nextActionForRecoveryCase({ stage: "matched", exceptionCode: "NO_OPEN_EXCEPTION", authorityConnected: true, hasReceipt: true }), "Review and recognise credit");
});
