import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditEvents, candidateMatches, evidenceDocuments, extractedFields, matchExecutions, recoveryCases } from "@/db/schema";
import { runAiTask } from "@/lib/ai/service";
import type { ExceptionExplanationOutput } from "@/lib/ai/contracts";
import { evaluateReceiptMatchDetailed, type ReceiptExtraction } from "@/lib/matching";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = await request.json() as { documentId?: unknown; caseId?: unknown; note?: unknown };
    const documentId = typeof body.documentId === "string" ? body.documentId.trim() : "";
    const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!documentId || !caseId || note.length < 8) return Response.json({ error: "Select a case and record a review note of at least 8 characters." }, { status: 400 });
    const db = getDb();
    const document = (await db.select().from(evidenceDocuments).where(eq(evidenceDocuments.id, documentId)).limit(1))[0];
    const recoveryCase = (await db.select().from(recoveryCases).where(eq(recoveryCases.id, caseId)).limit(1))[0];
    if (!document || !recoveryCase) return Response.json({ error: "The document or recovery case was not found." }, { status: 404 });
    if (["recognised", "closed"].includes(recoveryCase.stage)) return Response.json({ error: "Evidence cannot be attached to a recognised or closed case." }, { status: 409 });
    const candidate = (await db.select().from(candidateMatches).where(and(eq(candidateMatches.documentId, documentId), eq(candidateMatches.caseId, caseId))).limit(1))[0];
    if (!candidate) return Response.json({ error: "The selected case is not in the reviewed candidate set." }, { status: 409 });
    const fields = await db.select().from(extractedFields).where(eq(extractedFields.documentId, documentId));
    const effective = Object.fromEntries(fields.map((field) => [field.fieldName, field.reviewedValue ?? field.extractedValue]));
    const parseAmount = (value: string) => {
      const number = Number(value.replace(/[^0-9.]/g, ""));
      return Number.isFinite(number) && value.trim() ? Math.round(number * 100) : null;
    };
    const receipt: ReceiptExtraction = {
      customerName: effective.deducting_customer_name ?? "",
      beneficiaryTin: effective.beneficiary_tin ?? "",
      invoiceReference: effective.invoice_reference ?? "",
      receiptNumber: effective.receipt_number ?? "",
      whtAmountKobo: parseAmount(effective.wht_amount ?? ""),
      reportingPeriod: effective.reporting_period ?? "",
      fields: Object.fromEntries(fields.map((field) => [field.fieldName, { confidence: field.confidence, evidenceQuote: field.evidenceQuote, pageNumber: field.pageNumber }])),
    };
    const deterministic = evaluateReceiptMatchDetailed(receipt, recoveryCase);
    const now = new Date().toISOString();
    const matchId = crypto.randomUUID();
    await db.update(candidateMatches).set({ status: "rejected" }).where(eq(candidateMatches.documentId, documentId));
    await db.update(candidateMatches).set({ status: "confirmed" }).where(eq(candidateMatches.id, candidate.id));
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), caseId, documentId, eventType: "CANDIDATE_CONFIRMED", actor: "reviewer", detailJson: JSON.stringify({ candidateId: candidate.id, note, confirmedAt: now, rankingWasAdvisory: true }) });
    await db.insert(matchExecutions).values({ id: matchId, caseId, documentId, ruleVersion: deterministic.ruleVersion, resultJson: JSON.stringify(deterministic) });
    await db.update(recoveryCases).set({ receiptNumber: receipt.receiptNumber || null, receiptAmountKobo: receipt.whtAmountKobo, receiptBeneficiaryTin: receipt.beneficiaryTin || null, sourceDocumentId: documentId, stage: deterministic.stage, exceptionCode: deterministic.exceptionCode, confidence: deterministic.confidence, updatedAt: now }).where(eq(recoveryCases.id, caseId));
    await db.update(evidenceDocuments).set({ status: "ready_for_field_review" }).where(eq(evidenceDocuments.id, documentId));
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), caseId, documentId, eventType: "DETERMINISTIC_MATCH_COMPLETED", actor: "system", detailJson: JSON.stringify({ matchId, ...deterministic }) });
    const failedChecks = deterministic.checks.filter((check) => check.outcome === "fail").map((check) => check.label);
    const missingChecks = deterministic.checks.filter((check) => check.outcome === "missing").map((check) => check.label);
    const explanation = await runAiTask<ExceptionExplanationOutput>({ type: "exception_explanation", caseId, documentId, input: { caseId, documentId, ruleVersion: deterministic.ruleVersion, exceptionCode: deterministic.exceptionCode, failedChecks, missingChecks, checks: deterministic.checks } });
    return Response.json({ caseId, documentId, matchId, deterministic, explanation: explanation.output, ai: { jobId: explanation.jobId, provider: explanation.provider, model: explanation.model, promptVersion: explanation.promptVersion } });
  } catch (error) {
    console.error(JSON.stringify({ message: "evidence confirmation failed", category: "EVIDENCE_CONFIRMATION_ERROR" }));
    return Response.json({ error: error instanceof Error && error.message.includes("note") ? error.message : "The evidence confirmation could not be completed." }, { status: 500 });
  }
}
