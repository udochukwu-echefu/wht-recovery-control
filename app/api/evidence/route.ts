import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { candidateMatches, clients, evidenceDocuments, extractedFields, receiptRecords, recoveryCases } from "@/db/schema";
import { assertMachineOutcomeTransition, isTerminalRecoveryCaseStage, nextActionForRecoveryCase, projectRecoveryCaseStage } from "@/lib/case-stage-policy";
import { runAiTask } from "@/lib/ai/service";
import type { ExceptionExplanationOutput } from "@/lib/ai/contracts";
import { evaluateReceiptMatchDetailed, type ReceiptExtraction } from "@/lib/matching";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const body = await request.json() as { documentId?: unknown; caseId?: unknown; note?: unknown };
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!documentId || !caseId || note.length < 8) return Response.json({ error: "Select a case and record a review note of at least 8 characters." }, { status: 400 });
    const db = getDb();
    const document = (await db.select().from(evidenceDocuments).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId))).limit(1))[0];
    const recoveryCase = (await db.select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId))).limit(1))[0];
    if (!document || !recoveryCase) return Response.json({ error: "The document or recovery case was not found." }, { status: 404 });
    if (isTerminalRecoveryCaseStage(projectRecoveryCaseStage(recoveryCase.stage)) || recoveryCase.stage === "recognised") return Response.json({ error: "Evidence cannot be attached after recognition or a terminal outcome." }, { status: 409 });
    const candidate = (await db.select().from(candidateMatches).where(and(eq(candidateMatches.workspaceId, context.workspace.id), eq(candidateMatches.documentId, documentId), eq(candidateMatches.caseId, caseId))).limit(1))[0];
    if (!candidate || candidate.status !== "suggested") return Response.json({ error: "The selected case is not an open candidate for this document." }, { status: 409 });
    const existingReceipt = await db.select({ id: receiptRecords.id }).from(receiptRecords).where(and(eq(receiptRecords.workspaceId, context.workspace.id), eq(receiptRecords.documentId, documentId))).limit(1);
    if (existingReceipt.length) return Response.json({ error: "This document has already been confirmed as a receipt. Allocate the existing receipt instead of confirming it again." }, { status: 409 });
    const fields = await db.select().from(extractedFields).where(and(eq(extractedFields.documentId, documentId), eq(extractedFields.workspaceId, context.workspace.id)));
    const effective = Object.fromEntries(fields.map((field) => [field.fieldName, field.reviewedValue ?? field.extractedValue]));
    const parseAmount = (value: string) => {
      const number = Number(value.replace(/[^0-9.]/g, ""));
      return Number.isFinite(number) && value.trim() ? Math.round(number * 100) : null;
    };
    const receipt: ReceiptExtraction = {
      customerName: effective.deducting_customer_name ?? "",
      deductingCustomerTin: effective.deducting_customer_tin ?? "",
      beneficiaryTin: effective.beneficiary_tin ?? "",
      invoiceReference: effective.invoice_reference ?? "",
      receiptNumber: effective.receipt_number ?? "",
      whtAmountKobo: parseAmount(effective.wht_amount ?? ""),
      reportingPeriod: effective.reporting_period ?? "",
      fields: Object.fromEntries(fields.map((field) => [field.fieldName, { confidence: field.confidence, evidenceQuote: field.evidenceQuote, pageNumber: field.pageNumber }])),
    };
    const ruleSet = await getActiveRuleSet(context, recoveryCase.businessDate ?? undefined);
    const client = (await db.select({ tin: clients.tin }).from(clients).where(and(eq(clients.id, context.clientId), eq(clients.workspaceId, context.workspace.id))).limit(1))[0];
    const deterministic = evaluateReceiptMatchDetailed(receipt, { ...recoveryCase, beneficiaryTin: client?.tin ?? "" }, { version: ruleSet.version, amountToleranceKobo: ruleSet.toleranceAmountKobo });
    assertMachineOutcomeTransition(recoveryCase.stage, deterministic.stage);
    const nextAction = nextActionForRecoveryCase({ stage: deterministic.stage, exceptionCode: deterministic.exceptionCode, hasReceipt: true });
    const now = new Date().toISOString();
    const matchId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();
    const receiptAllocationId = crypto.randomUUID();
    const d1 = getD1();
    await d1.batch([
      d1.prepare("UPDATE candidate_matches SET status = 'rejected' WHERE workspace_id = ? AND document_id = ? AND status = 'suggested'")
        .bind(context.workspace.id, documentId),
      d1.prepare("UPDATE candidate_matches SET status = 'confirmed' WHERE id = ? AND workspace_id = ? AND document_id = ? AND case_id = ?")
        .bind(candidate.id, context.workspace.id, documentId, caseId),
      auditStatement(context, { caseId, documentId, eventType: "CANDIDATE_CONFIRMED", detail: { candidateId: candidate.id, note, confirmedAt: now, rankingWasAdvisory: true } }),
      d1.prepare("INSERT INTO match_executions (id, workspace_id, case_id, document_id, rule_version, result_json, factors_json, conflicts_json, tolerance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(matchId, context.workspace.id, caseId, documentId, deterministic.ruleVersion, JSON.stringify(deterministic), candidate.reasonsJson, candidate.conflictsJson, JSON.stringify({ amountKobo: ruleSet.toleranceAmountKobo }), now),
      d1.prepare("INSERT INTO receipt_records (id, workspace_id, client_id, document_id, receipt_reference, deducting_customer_tin, beneficiary_tin, amount_kobo, reporting_period, receipt_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review_required', ?)")
        .bind(receiptId, context.workspace.id, context.clientId, documentId, receipt.receiptNumber || null, effective.deducting_customer_tin || null, receipt.beneficiaryTin || null, receipt.whtAmountKobo, receipt.reportingPeriod || null, effective.deduction_date || null, now),
      d1.prepare("INSERT INTO receipt_allocations (id, workspace_id, receipt_id, case_id, amount_kobo, status, confirmed_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, 'provisional', ?, ?)")
        .bind(receiptAllocationId, context.workspace.id, receiptId, caseId, receipt.whtAmountKobo ?? recoveryCase.expectedWhtKobo, context.user.id, now),
      d1.prepare("UPDATE recovery_cases SET receipt_number = ?, receipt_amount_kobo = ?, receipt_beneficiary_tin = ?, source_document_id = ?, stage = ?, exception_code = ?, confidence = ?, next_action = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND client_id = ?")
        .bind(receipt.receiptNumber || null, receipt.whtAmountKobo, receipt.beneficiaryTin || null, documentId, deterministic.stage, deterministic.exceptionCode, deterministic.confidence, nextAction, now, caseId, context.workspace.id, context.clientId),
      d1.prepare("UPDATE evidence_documents SET status = 'ready_for_field_review' WHERE id = ? AND workspace_id = ? AND client_id = ?")
        .bind(documentId, context.workspace.id, context.clientId),
      auditStatement(context, { caseId, documentId, eventType: "DETERMINISTIC_MATCH_COMPLETED", actor: "system", detail: { matchId, receiptId, receiptAllocationId, ...deterministic } }),
    ]);
    const failedChecks = deterministic.checks.filter((check) => check.outcome === "fail").map((check) => check.label);
    const missingChecks = deterministic.checks.filter((check) => check.outcome === "missing").map((check) => check.label);
    const explanation = await runAiTask<ExceptionExplanationOutput>({ type: "exception_explanation", caseId, documentId, workspaceId: context.workspace.id, clientId: context.clientId, requestedByUserId: context.user.id, input: { caseId, documentId, ruleVersion: deterministic.ruleVersion, exceptionCode: deterministic.exceptionCode, failedChecks, missingChecks, checks: deterministic.checks } });
    return Response.json({ caseId, documentId, receiptId, matchId, deterministic, explanation: explanation.output, ai: { jobId: explanation.jobId, provider: explanation.provider, model: explanation.model, promptVersion: explanation.promptVersion } });
  } catch (error) {
    return apiError(error, "The evidence confirmation could not be completed.");
  }
}
