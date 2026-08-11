import { and, desc, eq, ne } from "drizzle-orm";
import { deleteEvidenceObject, getDb, putEvidenceObject } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditEvents, candidateMatches, documentIntelligence, evidenceDocuments, extractedFields, ledgerImports, recoveryCases } from "@/db/schema";
import { previewLedgerCsv } from "@/lib/csv";
import { buildCandidateFactors, type ReceiptExtraction } from "@/lib/matching";
import { runAiTask } from "@/lib/ai/service";
import type { CandidateRankingOutput, DocumentClassificationOutput, LedgerMappingOutput, ReceiptExtractionOutput } from "@/lib/ai/contracts";

export const runtime = "edge";

const MAX_FILE_BYTES = 1024 * 1024;
const allowedTypes = new Set(["text/csv", "text/plain", "application/pdf", "image/png", "image/jpeg", "image/webp"]);

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Unexpected intake error.";
  console.error(JSON.stringify({ message: "intake failed", error: message }));
  return Response.json({ error: status === 500 ? "The evidence could not be processed." : message }, { status });
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "evidence";
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_FILE_BYTES + 100_000) return jsonError(new Error("Maximum upload size is 1 MB for this pilot."), 413);

  let storedKey = "";
  let documentPersisted = false;
  let persistedDocumentId = "";
  try {
    await ensureSchema();
    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File)) return jsonError(new Error("A file is required."), 400);
    if (upload.size === 0 || upload.size > MAX_FILE_BYTES) return jsonError(new Error("File must be between 1 byte and 1 MB for this pilot."), 413);

    const lowerName = upload.name.toLowerCase();
    const isCsv = lowerName.endsWith(".csv") || upload.type === "text/csv";
    const isTextReceipt = lowerName.endsWith(".txt") || upload.type === "text/plain";
    const isReceipt = isTextReceipt || lowerName.endsWith(".pdf") || upload.type.startsWith("image/");
    if ((!allowedTypes.has(upload.type) && !isCsv && !isReceipt) || (!isCsv && !isReceipt)) {
      return jsonError(new Error("Use CSV for ledgers, or TXT/PDF/PNG/JPEG/WebP for receipts."), 415);
    }

    const bytes = await upload.arrayBuffer();
    const [hash, documentId] = await Promise.all([sha256Hex(bytes), Promise.resolve(crypto.randomUUID())]);
    storedKey = `evidence/${new Date().toISOString().slice(0, 10)}/${documentId}-${safeFileName(upload.name)}`;
    await putEvidenceObject(storedKey, bytes, upload.type || (isCsv ? "text/csv" : "application/octet-stream"));

    const db = getDb();
    await db.insert(evidenceDocuments).values({
      id: documentId,
      r2Key: storedKey,
      fileName: upload.name,
      mimeType: upload.type || "application/octet-stream",
      sizeBytes: upload.size,
      sha256: hash,
      kind: isCsv ? "ledger_csv" : "wht_receipt",
      status: "processing",
    });
    documentPersisted = true;
    persistedDocumentId = documentId;
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId, eventType: "DOCUMENT_UPLOADED", actor: "reviewer", detailJson: JSON.stringify({ fileName: upload.name, sha256: hash }) });

    if (isCsv) {
      const csv = new TextDecoder().decode(bytes);
      let preview;
      try {
        preview = previewLedgerCsv(csv);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ledger preview failed.";
        await db.update(evidenceDocuments).set({ status: "validation_failed", errorMessage: message }).where(eq(evidenceDocuments.id, documentId));
        return Response.json({ document: { id: documentId, fileName: upload.name, status: "validation_failed", rowCount: 0 }, errors: [message] }, { status: 422 });
      }
      const aiTask = await runAiTask<LedgerMappingOutput>({ type: "ledger_mapping", documentId, input: { documentId, headers: preview.headers, preview: preview.preview, detectedTypes: preview.detectedTypes, targetFieldAllowlist: ["customer_name", "customer_tin", "invoice_reference", "invoice_gross_amount", "payment_net_amount", "payment_date", "reporting_period", "expected_wht_amount", "currency", "entity_reference", "unmapped"] } });
      const fallbackMappings = preview.headers.map((sourceColumn) => ({ sourceColumn, targetField: "unmapped" as const, confidence: 0, reason: "AI assistance is unavailable; select a field manually" }));
      const mapping = aiTask.output ?? { mappings: fallbackMappings, detectedDateFormat: "Unknown", detectedCurrency: "NGN", warnings: [], unmappedColumns: preview.headers, overallConfidence: 0 };
      const requiresAttention = mapping.mappings.some((item) => item.targetField === "unmapped") || mapping.overallConfidence < 70;
      const importId = crypto.randomUUID();
      const status = aiTask.status === "manual_review" ? "manual_mapping_required" : requiresAttention ? "mapping_requires_attention" : "mapping_suggested";
      await db.insert(ledgerImports).values({ id: importId, documentId, status, headersJson: JSON.stringify(preview.headers), previewJson: JSON.stringify(preview.preview), detectedTypesJson: JSON.stringify(preview.detectedTypes), mappingJson: JSON.stringify(mapping.mappings), warningsJson: JSON.stringify(mapping.warnings), validationJson: JSON.stringify({}), aiJobId: aiTask.jobId });
      await db.update(evidenceDocuments).set({ status, rowCount: preview.rowCount }).where(eq(evidenceDocuments.id, documentId));
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId, eventType: "LEDGER_PREVIEW_CREATED", actor: "system", detailJson: JSON.stringify({ importId, rowCount: preview.rowCount, headerCount: preview.headers.length, aiJobId: aiTask.jobId, noCasesCreated: true }) });
      return Response.json({ document: { id: documentId, fileName: upload.name, status, rowCount: preview.rowCount }, workflow: { importId, status, ...preview, mapping, ai: { status: aiTask.status, provider: aiTask.provider, model: aiTask.model, promptVersion: aiTask.promptVersion, jobId: aiTask.jobId, safeMessage: aiTask.safeMessage } }, importedCases: 0 }, { status: 201 });
    }

    const suppliedText = form.get("documentText");
    const documentText = isTextReceipt ? new TextDecoder().decode(bytes) : typeof suppliedText === "string" ? suppliedText.trim() : "";
    const duplicate = (await db.select({ id: evidenceDocuments.id, fileName: evidenceDocuments.fileName, createdAt: evidenceDocuments.createdAt })
      .from(evidenceDocuments).where(and(eq(evidenceDocuments.sha256, hash), ne(evidenceDocuments.id, documentId))).orderBy(desc(evidenceDocuments.createdAt)).limit(1))[0] ?? null;
    const classificationTask = await runAiTask<DocumentClassificationOutput>({ type: "document_classification", documentId, input: { documentId, fileName: upload.name, mimeType: upload.type, sizeBytes: upload.size, documentText: documentText.slice(0, 20_000), potentialDuplicate: Boolean(duplicate) } });
    const classification = classificationTask.output ?? { documentType: "unknown" as const, confidence: 0, explanation: "Classification requires manual review", detectedPageCount: null, ocrRequired: !documentText, appearsIncomplete: false, potentialDuplicate: Boolean(duplicate) };
    await db.insert(documentIntelligence).values({ documentId, classificationJson: JSON.stringify(classification), duplicateJson: JSON.stringify(duplicate ? { duplicate: true, originalDocumentId: duplicate.id, fileName: duplicate.fileName, createdAt: duplicate.createdAt } : { duplicate: false }), textStatus: documentText ? "text_available" : "manual_entry_required", provider: classificationTask.provider, model: classificationTask.model, promptVersion: classificationTask.promptVersion });
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId, eventType: "DOCUMENT_CLASSIFIED", actor: "ai-assistant", detailJson: JSON.stringify({ classification, aiJobId: classificationTask.jobId, duplicate }) });

    if (!documentText) {
      await db.update(evidenceDocuments).set({ status: "manual_entry_required", kind: classification.documentType }).where(eq(evidenceDocuments.id, documentId));
      return Response.json({ document: { id: documentId, fileName: upload.name, status: "manual_entry_required", rowCount: 1 }, workflow: { kind: "evidence", documentId, classification, duplicate, extraction: null, candidates: [], recommendation: "manual_review", uncertainty: "No machine-readable text was available. Enter fields manually or attach OCR text; the original is retained." }, ai: { message: "Original saved. Receipt fields require manual entry or OCR text." } }, { status: 202 });
    }

    const extractionTask = await runAiTask<ReceiptExtractionOutput>({ type: "receipt_extraction", documentId, input: { documentId, documentText } });
    const extraction = extractionTask.output;
    if (!extraction) {
      await db.update(evidenceDocuments).set({ status: "manual_entry_required", kind: classification.documentType }).where(eq(evidenceDocuments.id, documentId));
      return Response.json({ document: { id: documentId, fileName: upload.name, status: "manual_entry_required", rowCount: 1 }, workflow: { kind: "evidence", documentId, classification, duplicate, extraction: null, candidates: [], recommendation: "manual_review", uncertainty: extractionTask.safeMessage ?? "Extraction requires manual review." }, ai: { message: "Original saved. Receipt extraction requires manual review." } }, { status: 202 });
    }
    for (const field of extraction.fields) {
      await db.insert(extractedFields).values({ id: crypto.randomUUID(), documentId, fieldName: field.fieldName, extractedValue: field.value, confidence: field.confidence, evidenceQuote: field.sourceQuote, pageNumber: field.pageNumber });
    }
    const fieldMap = Object.fromEntries(extraction.fields.map((field) => [field.fieldName, field.normalisedValue || field.value]));
    const amountText = String(fieldMap.wht_amount ?? "").replace(/[^0-9.]/g, "");
    const amountNaira = amountText ? Number(amountText) : Number.NaN;
    const receipt: ReceiptExtraction = {
      customerName: String(fieldMap.deducting_customer_name ?? ""),
      beneficiaryTin: String(fieldMap.beneficiary_tin ?? ""),
      invoiceReference: String(fieldMap.invoice_reference ?? ""),
      receiptNumber: String(fieldMap.receipt_number ?? ""),
      whtAmountKobo: Number.isFinite(amountNaira) ? Math.round(amountNaira * 100) : null,
      reportingPeriod: String(fieldMap.reporting_period ?? ""),
      fields: Object.fromEntries(extraction.fields.map((field) => [field.fieldName, { confidence: field.confidence, evidenceQuote: field.sourceQuote, pageNumber: field.pageNumber }])),
    };
    const cases = await db.select({ id: recoveryCases.id, customer: recoveryCases.customer, customerTin: recoveryCases.customerTin, invoiceReference: recoveryCases.invoiceReference, expectedWhtKobo: recoveryCases.expectedWhtKobo, reportingPeriod: recoveryCases.reportingPeriod })
      .from(recoveryCases).where(and(ne(recoveryCases.stage, "closed"), ne(recoveryCases.stage, "recognised"))).orderBy(desc(recoveryCases.updatedAt)).limit(500);
    const factorRows = buildCandidateFactors(receipt, cases).slice(0, 20);
    const rankingTask = await runAiTask<CandidateRankingOutput>({ type: "candidate_ranking", documentId, input: { documentId, extraction, candidates: factorRows } });
    const ranking = rankingTask.output ?? { candidates: factorRows.slice(0, 3).map((item, index) => ({ caseId: item.caseId, rank: index + 1, confidence: item.factors.score, reasons: item.factors.reasons, conflicts: item.factors.conflicts })), recommendation: "manual_review" as const, uncertainty: rankingTask.safeMessage ?? "Select a case manually." };
    for (const candidate of ranking.candidates) await db.insert(candidateMatches).values({ id: crypto.randomUUID(), documentId, caseId: candidate.caseId, rank: candidate.rank, confidence: candidate.confidence, reasonsJson: JSON.stringify(candidate.reasons), conflictsJson: JSON.stringify(candidate.conflicts), status: "suggested" });
    await db.update(evidenceDocuments).set({ status: "candidate_review", kind: classification.documentType, rowCount: 1, aiModel: extractionTask.model, aiResponseId: extractionTask.jobId }).where(eq(evidenceDocuments.id, documentId));
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId, eventType: "CANDIDATES_RANKED", actor: "ai-assistant", detailJson: JSON.stringify({ extractionJobId: extractionTask.jobId, rankingJobId: rankingTask.jobId, recommendation: ranking.recommendation, attachmentPerformed: false }) });
    const caseLookup = new Map(cases.map((item) => [item.id, item]));
    return Response.json({ document: { id: documentId, fileName: upload.name, status: "candidate_review", rowCount: 1 }, workflow: { kind: "evidence", documentId, classification, duplicate, extraction, candidates: ranking.candidates.map((item) => ({ ...item, case: caseLookup.get(item.caseId) })), recommendation: ranking.recommendation, uncertainty: ranking.uncertainty, untrustedInstructionsDetected: extraction.untrustedInstructionsDetected }, ai: { configured: true, provider: extractionTask.provider, model: extractionTask.model, promptVersion: extractionTask.promptVersion, message: "Extraction complete. A reviewer must confirm the case before deterministic matching runs." } }, { status: 201 });
  } catch (error) {
    if (documentPersisted && persistedDocumentId) {
      try {
        await getDb().update(evidenceDocuments).set({ status: "processing_failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unexpected processing error." }).where(eq(evidenceDocuments.id, persistedDocumentId));
      } catch { /* The structured error log below remains the source of truth if D1 is unavailable. */ }
    } else if (storedKey) {
      try { await deleteEvidenceObject(storedKey); } catch { /* Preserve the primary error; orphan cleanup is best effort. */ }
    }
    return jsonError(error);
  }
}
