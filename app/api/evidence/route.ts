import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { candidateMatches, clients, evidenceDocuments, extractedFields, matchExecutions, receiptAllocations, receiptRecords, recoveryCases } from "@/db/schema";
import { runAiTask } from "@/lib/ai/service";
import type { ExceptionExplanationOutput } from "@/lib/ai/contracts";
import { evaluateReceiptMatchDetailed, type ReceiptExtraction } from "@/lib/matching";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const body = await request.json() as { documentId?: unknown; caseId?: unknown; note?: unknown };
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!documentId || !caseId || note.length < 8) return Response.json({ error: "Select a case and record a review note of at least 8 characters." }, { status: 400 });
    const db = getDb();
    const document = (await db.select().from(evidenceDocuments).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id))).limit(1))[0];
    const recoveryCase = (await db.select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id))).limit(1))[0];
    if (!document || !recoveryCase) return Response.json({ error: "The document or recovery case was not found." }, { status: 404 });
    if (["recognised", "closed"].includes(recoveryCase.stage)) return Response.json({ error: "Evidence cannot be attached to a recognised or closed case." }, { status: 409 });
    const candidate = (await db.select().from(candidateMatches).where(and(eq(candidateMatches.workspaceId, context.workspace.id), eq(candidateMatches.documentId, documentId), eq(candidateMatches.caseId, caseId))).limit(1))[0];
    if (!candidate) return Response.json({ error: "The selected case is not in the reviewed candidate set." }, { status: 409 });
    const fields = await db.select().from(extractedFields).where(eq(extractedFields.documentId, documentId));
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
    const now = new Date().toISOString();
    const matchId = crypto.randomUUID();
    const receiptId = crypto.randomUUID();
    await db.update(candidateMatches).set({ status: "rejected" }).where(and(eq(candidateMatches.workspaceId, context.workspace.id), eq(candidateMatches.documentId, documentId)));
    await db.update(candidateMatches).set({ status: "confirmed" }).where(eq(candidateMatches.id, candidate.id));
    await auditStatement(context, { caseId, documentId, eventType: "CANDIDATE_CONFIRMED", detail: { candidateId: candidate.id, note, confirmedAt: now, rankingWasAdvisory: true } }).run();
    await db.insert(matchExecutions).values({ id: matchId, workspaceId: context.workspace.id, caseId, documentId, ruleVersion: deterministic.ruleVersion, resultJson: JSON.stringify(deterministic), factorsJson: candidate.reasonsJson, conflictsJson: candidate.conflictsJson, toleranceJson: JSON.stringify({ amountKobo: ruleSet.toleranceAmountKobo }) });
    await db.insert(receiptRecords).values({
      id: receiptId, workspaceId: context.workspace.id, clientId: context.clientId, documentId,
      receiptReference: receipt.receiptNumber || null, deductingCustomerTin: effective.deducting_customer_tin || null,
      beneficiaryTin: receipt.beneficiaryTin || null, amountKobo: receipt.whtAmountKobo,
      reportingPeriod: receipt.reportingPeriod || null, receiptDate: effective.deduction_date || null,
      status: "review_required",
    });
    await db.insert(receiptAllocations).values({ id: crypto.randomUUID(), workspaceId: context.workspace.id, receiptId, caseId, amountKobo: receipt.whtAmountKobo ?? recoveryCase.expectedWhtKobo, status: "provisional", confirmedByUserId: context.user.id });
    await db.update(recoveryCases).set({ receiptNumber: receipt.receiptNumber || null, receiptAmountKobo: receipt.whtAmountKobo, receiptBeneficiaryTin: receipt.beneficiaryTin || null, sourceDocumentId: documentId, stage: deterministic.stage, exceptionCode: deterministic.exceptionCode, confidence: deterministic.confidence, updatedAt: now }).where(eq(recoveryCases.id, caseId));
    await db.update(evidenceDocuments).set({ status: "ready_for_field_review" }).where(eq(evidenceDocuments.id, documentId));
    await auditStatement(context, { caseId, documentId, eventType: "DETERMINISTIC_MATCH_COMPLETED", actor: "system", detail: { matchId, ...deterministic } }).run();
    const failedChecks = deterministic.checks.filter((check) => check.outcome === "fail").map((check) => check.label);
    const missingChecks = deterministic.checks.filter((check) => check.outcome === "missing").map((check) => check.label);
    const explanation = await runAiTask<ExceptionExplanationOutput>({ type: "exception_explanation", caseId, documentId, workspaceId: context.workspace.id, requestedByUserId: context.user.id, input: { caseId, documentId, ruleVersion: deterministic.ruleVersion, exceptionCode: deterministic.exceptionCode, failedChecks, missingChecks, checks: deterministic.checks } });
    return Response.json({ caseId, documentId, receiptId, matchId, deterministic, explanation: explanation.output, ai: { jobId: explanation.jobId, provider: explanation.provider, model: explanation.model, promptVersion: explanation.promptVersion } });
  } catch (error) {
    return apiError(error, "The evidence confirmation could not be completed.");
  }
}
