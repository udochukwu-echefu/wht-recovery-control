import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { clients, documentIntelligence, evidenceDocuments, ledgerImports, recoveryCases } from "@/db/schema";
import { previewLedgerCsv } from "@/lib/csv";
import { buildCandidateFactors, type ReceiptExtraction } from "@/lib/matching";
import { runAiTask } from "@/lib/ai/service";
import type { CandidateRankingOutput, DocumentClassificationOutput, LedgerMappingOutput, ReceiptExtractionOutput } from "@/lib/ai/contracts";
import { apiError, auditStatement, enforceRateLimit, requireContext } from "@/lib/auth";
import { machineMutableRecoveryCaseStages } from "@/lib/case-stage-policy";
import { deleteStoredObject, putStoredObject, validateUpload } from "@/lib/storage";
import { extractDocumentText } from "@/lib/ocr";

export const runtime = "edge";

export async function POST(request: Request) {
  let storedKey = "";
  let documentPersisted = false;
  let persistedDocumentId = "";
  let persistedWorkspaceId = "";
  let persistedClientId = "";
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    await enforceRateLimit(context, "intake", 12, 60);
    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File)) return Response.json({ error: "A file is required." }, { status: 400 });

    const bytes = await upload.arrayBuffer();
    const fileType = validateUpload(upload, bytes);
    const isCsv = fileType.isLedger;
    const isTextReceipt = fileType.isText && !isCsv;
    const stored = await putStoredObject(context, upload, bytes);
    const { documentId, sha256: hash } = stored;
    storedKey = stored.storageKey;
    const retentionUntil = new Date(Date.now() + stored.retentionDays * 86_400_000).toISOString();

    const db = getDb();
    await db.insert(evidenceDocuments).values({
      id: documentId,
      workspaceId: context.workspace.id,
      clientId: context.clientId,
      storageKey: storedKey,
      fileName: upload.name,
      mimeType: upload.type || "application/octet-stream",
      sizeBytes: upload.size,
      sha256: hash,
      kind: isCsv ? "ledger_csv" : "wht_receipt",
      status: "processing",
      retentionUntil,
    });
    documentPersisted = true;
    persistedDocumentId = documentId;
    persistedWorkspaceId = context.workspace.id;
    persistedClientId = context.clientId;
    await auditStatement(context, { documentId, eventType: "DOCUMENT_UPLOADED", detail: { fileName: upload.name, sha256: hash, sizeBytes: upload.size, retentionUntil } }).run();

    if (isCsv) {
      const csv = new TextDecoder().decode(bytes);
      let preview;
      try {
        preview = previewLedgerCsv(csv);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ledger preview failed.";
        await db.update(evidenceDocuments).set({ status: "validation_failed", errorMessage: message }).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId)));
        return Response.json({ document: { id: documentId, fileName: upload.name, status: "validation_failed", rowCount: 0 }, errors: [message] }, { status: 422 });
      }
      const aiTask = await runAiTask<LedgerMappingOutput>({ type: "ledger_mapping", documentId, workspaceId: context.workspace.id, clientId: context.clientId, requestedByUserId: context.user.id, input: { documentId, headers: preview.headers, preview: preview.preview, detectedTypes: preview.detectedTypes, targetFieldAllowlist: ["customer_name", "customer_tin", "invoice_reference", "invoice_gross_amount", "payment_net_amount", "payment_date", "reporting_period", "expected_wht_amount", "currency", "entity_reference", "unmapped"] } });
      const fallbackMappings = preview.headers.map((sourceColumn) => ({ sourceColumn, targetField: "unmapped" as const, confidence: 0, reason: "AI assistance is unavailable; select a field manually" }));
      const mapping = aiTask.output ?? { mappings: fallbackMappings, detectedDateFormat: "Unknown", detectedCurrency: "NGN", warnings: [], unmappedColumns: preview.headers, overallConfidence: 0 };
      const requiresAttention = mapping.mappings.some((item) => item.targetField === "unmapped") || mapping.overallConfidence < 70;
      const importId = crypto.randomUUID();
      const status = aiTask.status === "manual_review" ? "manual_mapping_required" : requiresAttention ? "mapping_requires_attention" : "mapping_suggested";
      await db.insert(ledgerImports).values({ id: importId, workspaceId: context.workspace.id, clientId: context.clientId, documentId, status, headersJson: JSON.stringify(preview.headers), previewJson: JSON.stringify(preview.preview), detectedTypesJson: JSON.stringify(preview.detectedTypes), mappingJson: JSON.stringify(mapping.mappings), warningsJson: JSON.stringify(mapping.warnings), validationJson: JSON.stringify({}), aiJobId: aiTask.jobId, idempotencyKey: hash });
      await db.update(evidenceDocuments).set({ status, rowCount: preview.rowCount }).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId)));
      await auditStatement(context, { documentId, eventType: "LEDGER_PREVIEW_CREATED", actor: "system", detail: { importId, rowCount: preview.rowCount, headerCount: preview.headers.length, aiJobId: aiTask.jobId, noCasesCreated: true } }).run();
      return Response.json({ document: { id: documentId, fileName: upload.name, status, rowCount: preview.rowCount }, workflow: { importId, status, ...preview, mapping, ai: { status: aiTask.status, provider: aiTask.provider, model: aiTask.model, promptVersion: aiTask.promptVersion, jobId: aiTask.jobId, safeMessage: aiTask.safeMessage } }, importedCases: 0 }, { status: 201 });
    }

    const suppliedText = form.get("documentText");
    const ocr = await extractDocumentText({ documentId, fileName: upload.name, mimeType: upload.type, suppliedText: isTextReceipt ? new TextDecoder().decode(bytes) : typeof suppliedText === "string" ? suppliedText : "" });
    const documentText = ocr.text;
    const duplicate = (await db.select({ id: evidenceDocuments.id, fileName: evidenceDocuments.fileName, createdAt: evidenceDocuments.createdAt })
      .from(evidenceDocuments).where(and(eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId), eq(evidenceDocuments.sha256, hash), ne(evidenceDocuments.id, documentId))).orderBy(desc(evidenceDocuments.createdAt)).limit(1))[0] ?? null;
    const classificationTask = await runAiTask<DocumentClassificationOutput>({ type: "document_classification", documentId, workspaceId: context.workspace.id, clientId: context.clientId, requestedByUserId: context.user.id, input: { documentId, fileName: upload.name, mimeType: upload.type, sizeBytes: upload.size, documentText: documentText.slice(0, 20_000), potentialDuplicate: Boolean(duplicate) } });
    const classification = classificationTask.output ?? { documentType: "unknown" as const, confidence: 0, explanation: "Classification requires manual review", detectedPageCount: null, ocrRequired: !documentText, appearsIncomplete: false, potentialDuplicate: Boolean(duplicate) };
    await db.insert(documentIntelligence).values({ documentId, workspaceId: context.workspace.id, classificationJson: JSON.stringify(classification), duplicateJson: JSON.stringify(duplicate ? { duplicate: true, originalDocumentId: duplicate.id, fileName: duplicate.fileName, createdAt: duplicate.createdAt } : { duplicate: false }), textStatus: ocr.status === "completed" ? "text_available" : "manual_entry_required", provider: classificationTask.provider, model: classificationTask.model, promptVersion: classificationTask.promptVersion });
    await auditStatement(context, { documentId, eventType: "DOCUMENT_CLASSIFIED", actor: "ai-assistant", detail: { classification, aiJobId: classificationTask.jobId, duplicate } }).run();

    if (!documentText) {
      await db.update(evidenceDocuments).set({ status: "manual_entry_required", kind: classification.documentType }).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId)));
      return Response.json({ document: { id: documentId, fileName: upload.name, status: "manual_entry_required", rowCount: 1 }, workflow: { kind: "evidence", documentId, classification, duplicate, extraction: null, candidates: [], recommendation: "manual_review", uncertainty: "No machine-readable text was available. Enter fields manually or attach OCR text; the original is retained.", ocr }, ai: { message: "Original saved. Receipt fields require manual entry or OCR text." } }, { status: 202 });
    }

    const extractionTask = await runAiTask<ReceiptExtractionOutput>({ type: "receipt_extraction", documentId, workspaceId: context.workspace.id, clientId: context.clientId, requestedByUserId: context.user.id, input: { documentId, documentText } });
    const extraction = extractionTask.output;
    if (!extraction) {
      await db.update(evidenceDocuments).set({ status: "manual_entry_required", kind: classification.documentType }).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId)));
      return Response.json({ document: { id: documentId, fileName: upload.name, status: "manual_entry_required", rowCount: 1 }, workflow: { kind: "evidence", documentId, classification, duplicate, extraction: null, candidates: [], recommendation: "manual_review", uncertainty: extractionTask.safeMessage ?? "Extraction requires manual review." }, ai: { message: "Original saved. Receipt extraction requires manual review." } }, { status: 202 });
    }
    const fieldMap = Object.fromEntries(extraction.fields.map((field) => [field.fieldName, field.value]));
    const amountText = String(fieldMap.wht_amount ?? "").replace(/[^0-9.]/g, "");
    const amountNaira = amountText ? Number(amountText) : Number.NaN;
    const receipt: ReceiptExtraction = {
      customerName: String(fieldMap.deducting_customer_name ?? ""),
      deductingCustomerTin: String(fieldMap.deducting_customer_tin ?? ""),
      beneficiaryTin: String(fieldMap.beneficiary_tin ?? ""),
      invoiceReference: String(fieldMap.invoice_reference ?? ""),
      receiptNumber: String(fieldMap.receipt_number ?? ""),
      whtAmountKobo: Number.isFinite(amountNaira) ? Math.round(amountNaira * 100) : null,
      reportingPeriod: String(fieldMap.reporting_period ?? ""),
      fields: Object.fromEntries(extraction.fields.map((field) => [field.fieldName, { confidence: field.confidence, evidenceQuote: field.sourceQuote, pageNumber: field.pageNumber }])),
    };
    const client = (await db.select({ tin: clients.tin }).from(clients).where(and(eq(clients.id, context.clientId), eq(clients.workspaceId, context.workspace.id))).limit(1))[0];
    const cases = (await db.select({ id: recoveryCases.id, customer: recoveryCases.customer, customerTin: recoveryCases.customerTin, invoiceReference: recoveryCases.invoiceReference, expectedWhtKobo: recoveryCases.expectedWhtKobo, reportingPeriod: recoveryCases.reportingPeriod })
      .from(recoveryCases).where(and(eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId), isNull(recoveryCases.deletedAt), inArray(recoveryCases.stage, machineMutableRecoveryCaseStages))).orderBy(desc(recoveryCases.updatedAt)).limit(500))
      .map((item) => ({ ...item, beneficiaryTin: client?.tin ?? "" }));
    const factorRows = buildCandidateFactors(receipt, cases).slice(0, 20);
    const rankingTask = await runAiTask<CandidateRankingOutput>({ type: "candidate_ranking", documentId, workspaceId: context.workspace.id, clientId: context.clientId, requestedByUserId: context.user.id, input: { documentId, extraction, candidates: factorRows } });
    const ranking = rankingTask.output ?? { candidates: factorRows.slice(0, 3).map((item, index) => ({ caseId: item.caseId, rank: index + 1, confidence: item.factors.score, reasons: item.factors.reasons, conflicts: item.factors.conflicts })), recommendation: "manual_review" as const, uncertainty: rankingTask.safeMessage ?? "Select a case manually." };
    const persistedAt = new Date().toISOString();
    const d1 = getD1();
    await d1.batch([
      ...extraction.fields.map((field) => d1.prepare("INSERT INTO extracted_fields (id, workspace_id, document_id, field_name, extracted_value, confidence, evidence_quote, page_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), context.workspace.id, documentId, field.fieldName, field.value, field.confidence, field.sourceQuote, field.pageNumber)),
      ...ranking.candidates.map((candidate) => d1.prepare("INSERT INTO candidate_matches (id, workspace_id, document_id, case_id, rank, confidence, reasons_json, conflicts_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?)")
        .bind(crypto.randomUUID(), context.workspace.id, documentId, candidate.caseId, candidate.rank, candidate.confidence, JSON.stringify(candidate.reasons), JSON.stringify(candidate.conflicts), persistedAt)),
      d1.prepare("UPDATE evidence_documents SET status = 'candidate_review', kind = ?, row_count = 1, ai_model = ?, ai_response_id = ? WHERE id = ? AND workspace_id = ? AND client_id = ?")
        .bind(classification.documentType, extractionTask.model, extractionTask.jobId, documentId, context.workspace.id, context.clientId),
      auditStatement(context, { documentId, eventType: "CANDIDATES_RANKED", actor: "ai-assistant", detail: { extractionJobId: extractionTask.jobId, rankingJobId: rankingTask.jobId, recommendation: ranking.recommendation, attachmentPerformed: false } }),
    ]);
    const caseLookup = new Map(cases.map((item) => [item.id, item]));
    return Response.json({ document: { id: documentId, fileName: upload.name, status: "candidate_review", rowCount: 1 }, workflow: { kind: "evidence", documentId, classification, duplicate, extraction, candidates: ranking.candidates.map((item) => ({ ...item, case: caseLookup.get(item.caseId) })), recommendation: ranking.recommendation, uncertainty: ranking.uncertainty, untrustedInstructionsDetected: extraction.untrustedInstructionsDetected }, ai: { configured: true, provider: extractionTask.provider, model: extractionTask.model, promptVersion: extractionTask.promptVersion, message: "Extraction complete. A reviewer must confirm the case before deterministic matching runs." } }, { status: 201 });
  } catch (error) {
    if (documentPersisted && persistedDocumentId) {
      try {
        await getDb().update(evidenceDocuments).set({ status: "processing_failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unexpected processing error." }).where(and(eq(evidenceDocuments.id, persistedDocumentId), eq(evidenceDocuments.workspaceId, persistedWorkspaceId), eq(evidenceDocuments.clientId, persistedClientId)));
      } catch { /* The structured error log below remains the source of truth if D1 is unavailable. */ }
    } else if (storedKey) {
      try {
        const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
        await deleteStoredObject(context, storedKey);
      } catch { /* Preserve the primary error; orphan cleanup is best effort. */ }
    }
    return apiError(error, "The evidence could not be processed.");
  }
}
