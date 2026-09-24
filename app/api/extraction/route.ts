import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { clients, evidenceDocuments, recoveryCases } from "@/db/schema";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { machineMutableRecoveryCaseStages } from "@/lib/case-stage-policy";
import { buildCandidateFactors, type ReceiptExtraction } from "@/lib/matching";

export const runtime = "edge";

const allowedFields = new Set(["deducting_customer_name", "deducting_customer_tin", "beneficiary_name", "beneficiary_tin", "invoice_reference", "receipt_number", "wht_amount", "gross_amount", "deduction_date", "reporting_period", "transaction_category", "issuing_authority"]);

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const body = await request.json() as Record<string, unknown>;
    const documentId = String(body.documentId ?? "").trim();
    const note = String(body.note ?? "").trim();
    const supplied = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields as Record<string, unknown> : {};
    if (!documentId || note.length < 10) return Response.json({ error: "Document and a manual-entry note of at least 10 characters are required." }, { status: 400 });
    const unknown = Object.keys(supplied).find((field) => !allowedFields.has(field));
    if (unknown) return Response.json({ error: `${unknown} is not an allowed receipt field.` }, { status: 400 });
    const fields = Object.fromEntries(Object.entries(supplied).map(([name, value]) => [name, String(value ?? "").trim().slice(0, 500)]));
    const required = ["deducting_customer_name", "beneficiary_tin", "invoice_reference", "receipt_number", "wht_amount", "reporting_period"];
    const missing = required.filter((field) => !fields[field]);
    if (missing.length) return Response.json({ error: `Manual receipt entry is missing: ${missing.join(", ")}.` }, { status: 400 });
    const db = getDb();
    const document = (await db.select().from(evidenceDocuments).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId))).limit(1))[0];
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    if (!["manual_entry_required", "processing_failed"].includes(document.status)) return Response.json({ error: "This document is not awaiting manual extraction." }, { status: 409 });
    const client = (await db.select({ tin: clients.tin }).from(clients).where(and(eq(clients.id, context.clientId), eq(clients.workspaceId, context.workspace.id))).limit(1))[0];
    const cases = (await db.select({ id: recoveryCases.id, customer: recoveryCases.customer, customerTin: recoveryCases.customerTin, invoiceReference: recoveryCases.invoiceReference, expectedWhtKobo: recoveryCases.expectedWhtKobo, reportingPeriod: recoveryCases.reportingPeriod }).from(recoveryCases)
      .where(and(eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId), isNull(recoveryCases.deletedAt), inArray(recoveryCases.stage, machineMutableRecoveryCaseStages))).orderBy(desc(recoveryCases.updatedAt)).limit(500))
      .map((item) => ({ ...item, beneficiaryTin: client?.tin ?? "" }));
    const amount = Number((fields.wht_amount ?? "").replace(/[^0-9.]/g, ""));
    const receipt: ReceiptExtraction = { customerName: fields.deducting_customer_name, deductingCustomerTin: fields.deducting_customer_tin ?? "", beneficiaryTin: fields.beneficiary_tin, invoiceReference: fields.invoice_reference, receiptNumber: fields.receipt_number, whtAmountKobo: Number.isFinite(amount) ? Math.round(amount * 100) : null, reportingPeriod: fields.reporting_period, fields: {} };
    const ranked = buildCandidateFactors(receipt, cases).slice(0, 3);
    if (!ranked.length) return Response.json({ error: "No open cases are available for candidate review." }, { status: 409 });
    const reviewedAt = new Date().toISOString();
    const d1 = getD1();
    await d1.batch([
      ...Object.entries(fields).map(([fieldName, value]) => d1.prepare("INSERT INTO extracted_fields (id, workspace_id, document_id, field_name, extracted_value, confidence, evidence_quote, page_number, reviewed_at, reviewed_by_user_id) VALUES (?, ?, ?, ?, ?, 100, ?, NULL, ?, ?)")
        .bind(crypto.randomUUID(), context.workspace.id, documentId, fieldName, value, "Manually entered from retained original", reviewedAt, context.user.id)),
      ...ranked.map((candidate, index) => d1.prepare("INSERT INTO candidate_matches (id, workspace_id, document_id, case_id, rank, confidence, reasons_json, conflicts_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?)")
        .bind(crypto.randomUUID(), context.workspace.id, documentId, candidate.caseId, index + 1, candidate.factors.score, JSON.stringify(candidate.factors.reasons), JSON.stringify(candidate.factors.conflicts), reviewedAt)),
      d1.prepare("UPDATE evidence_documents SET status = 'candidate_review', kind = 'wht_receipt', row_count = 1 WHERE id = ? AND workspace_id = ? AND client_id = ?")
        .bind(documentId, context.workspace.id, context.clientId),
      auditStatement(context, { documentId, eventType: "MANUAL_EXTRACTION_RECORDED", detail: { note, fields: Object.keys(fields), candidateCaseIds: ranked.map((item) => item.caseId) } }),
    ]);
    return Response.json({ documentId, status: "candidate_review", candidates: ranked.map((item, index) => ({ caseId: item.caseId, rank: index + 1, confidence: item.factors.score, reasons: item.factors.reasons, conflicts: item.factors.conflicts })) });
  } catch (error) {
    return apiError(error, "Manual extraction could not be saved.");
  }
}
