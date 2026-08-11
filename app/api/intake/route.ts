import { and, desc, eq, ne } from "drizzle-orm";
import { getDb, getDeepSeekConfig, getEvidenceBucket } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditEvents, evidenceDocuments, extractedFields, recoveryCases } from "@/db/schema";
import { parseLedgerCsv } from "@/lib/csv";
import { chooseReceiptCandidate, evaluateReceiptMatch } from "@/lib/matching";
import { extractReceiptText } from "@/lib/deepseek-extraction";

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
  if (declaredLength > MAX_FILE_BYTES + 100_000) return jsonError(new Error("Maximum upload size is 1 MB."), 413);

  let storedKey = "";
  let documentPersisted = false;
  let persistedDocumentId = "";
  try {
    await ensureSchema();
    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File)) return jsonError(new Error("A file is required."), 400);
    if (upload.size === 0 || upload.size > MAX_FILE_BYTES) return jsonError(new Error("File must be between 1 byte and 1 MB."), 413);

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
    const bucket = getEvidenceBucket();
    await bucket.put(storedKey, bytes, {
      httpMetadata: { contentType: upload.type || (isCsv ? "text/csv" : "application/octet-stream") },
      customMetadata: { originalName: safeFileName(upload.name), sha256: hash },
    });

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
      const parsed = parseLedgerCsv(new TextDecoder().decode(bytes));
      if (!parsed.rows.length) {
        await db.update(evidenceDocuments).set({ status: "validation_failed", errorMessage: parsed.errors.join(" ") }).where(eq(evidenceDocuments.id, documentId));
        return Response.json({ document: { id: documentId, fileName: upload.name, status: "validation_failed", rowCount: 0 }, errors: parsed.errors }, { status: 422 });
      }

      for (const row of parsed.rows) {
        const caseId = `WHT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        await db.insert(recoveryCases).values({ id: caseId, ...row, sourceDocumentId: documentId });
        await db.insert(auditEvents).values({ id: crypto.randomUUID(), caseId, documentId, eventType: "CASE_CREATED", actor: "system", detailJson: JSON.stringify({ ruleVersion: "2026.07", source: upload.name }) });
      }
      await db.update(evidenceDocuments).set({ status: "validated", rowCount: parsed.rows.length }).where(eq(evidenceDocuments.id, documentId));
      return Response.json({ document: { id: documentId, fileName: upload.name, status: "validated", rowCount: parsed.rows.length }, importedCases: parsed.rows.length, warnings: parsed.errors }, { status: 201 });
    }

    const suppliedText = form.get("documentText");
    const documentText = isTextReceipt
      ? new TextDecoder().decode(bytes)
      : typeof suppliedText === "string" ? suppliedText.trim() : "";

    if (!documentText) {
      await db.update(evidenceDocuments).set({ status: "text_extraction_required" }).where(eq(evidenceDocuments.id, documentId));
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId, eventType: "AI_EXTRACTION_DEFERRED", actor: "system", detailJson: JSON.stringify({ reason: "DeepSeek V4 Flash is text-only; OCR or PDF text extraction is required" }) });
      return Response.json({
        document: { id: documentId, fileName: upload.name, status: "text_extraction_required", rowCount: 1 },
        ai: { requiresText: true, message: "Original saved. DeepSeek needs extracted text; paste OCR/PDF text to continue." },
      }, { status: 202 });
    }

    const config = getDeepSeekConfig();
    if (!config.apiKey) {
      await db.update(evidenceDocuments).set({ status: "ai_configuration_required" }).where(eq(evidenceDocuments.id, documentId));
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId, eventType: "AI_EXTRACTION_DEFERRED", actor: "system", detailJson: JSON.stringify({ reason: "DEEPSEEK_API_KEY is not configured" }) });
      return Response.json({ document: { id: documentId, fileName: upload.name, status: "ai_configuration_required", rowCount: 1 }, ai: { configured: false, message: "Receipt text saved. Configure DEEPSEEK_API_KEY to extract fields." } }, { status: 202 });
    }

    const ai = await extractReceiptText({ documentText, apiKey: config.apiKey, model: config.model });
    const extractedValues: Record<string, string> = {
      customer_name: ai.extraction.customerName,
      beneficiary_tin: ai.extraction.beneficiaryTin,
      invoice_reference: ai.extraction.invoiceReference,
      receipt_number: ai.extraction.receiptNumber,
      wht_amount: ai.extraction.whtAmountKobo === null ? "" : String(ai.extraction.whtAmountKobo / 100),
      reporting_period: ai.extraction.reportingPeriod,
    };
    for (const [fieldName, provenance] of Object.entries(ai.extraction.fields)) {
      await db.insert(extractedFields).values({ id: crypto.randomUUID(), documentId, fieldName, extractedValue: extractedValues[fieldName] ?? "", confidence: provenance.confidence, evidenceQuote: provenance.evidenceQuote, pageNumber: provenance.pageNumber });
    }

    const candidates = await db.select({
      id: recoveryCases.id,
      customer: recoveryCases.customer,
      customerTin: recoveryCases.customerTin,
      invoiceReference: recoveryCases.invoiceReference,
      expectedWhtKobo: recoveryCases.expectedWhtKobo,
      reportingPeriod: recoveryCases.reportingPeriod,
    }).from(recoveryCases).where(and(ne(recoveryCases.stage, "closed"), ne(recoveryCases.stage, "recognised"))).orderBy(desc(recoveryCases.updatedAt)).limit(500);
    const selected = chooseReceiptCandidate(ai.extraction, candidates);
    let match: { caseId: string; stage: string; exceptionCode: string; confidence: number } | null = null;
    if (selected) {
      const outcome = evaluateReceiptMatch(ai.extraction, selected.candidate);
      await db.update(recoveryCases).set({
        receiptNumber: ai.extraction.receiptNumber || null,
        receiptAmountKobo: ai.extraction.whtAmountKobo,
        receiptBeneficiaryTin: ai.extraction.beneficiaryTin || null,
        reportingPeriod: ai.extraction.reportingPeriod || selected.candidate.reportingPeriod,
        sourceDocumentId: documentId,
        stage: outcome.stage,
        exceptionCode: outcome.exceptionCode,
        confidence: outcome.confidence,
        updatedAt: new Date().toISOString(),
      }).where(eq(recoveryCases.id, selected.candidate.id));
      match = { caseId: selected.candidate.id, ...outcome };
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), caseId: selected.candidate.id, documentId, eventType: "DETERMINISTIC_MATCH_COMPLETED", actor: "system", detailJson: JSON.stringify({ candidateScore: selected.score, ...outcome, ruleVersion: "2026.07" }) });
    } else {
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId, eventType: "RECEIPT_UNMATCHED", actor: "system", detailJson: JSON.stringify({ invoiceReference: ai.extraction.invoiceReference }) });
    }
    await db.update(evidenceDocuments).set({ status: selected ? "ready_for_review" : "unmatched", rowCount: 1, aiModel: ai.model, aiResponseId: ai.responseId }).where(eq(evidenceDocuments.id, documentId));
    return Response.json({ document: { id: documentId, fileName: upload.name, status: selected ? "ready_for_review" : "unmatched", rowCount: 1 }, ai: { configured: true, provider: "deepseek", model: ai.model, extraction: ai.extraction }, match }, { status: 201 });
  } catch (error) {
    if (documentPersisted && persistedDocumentId) {
      try {
        await getDb().update(evidenceDocuments).set({ status: "processing_failed", errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Unexpected processing error." }).where(eq(evidenceDocuments.id, persistedDocumentId));
      } catch { /* The structured error log below remains the source of truth if D1 is unavailable. */ }
    } else if (storedKey) {
      try { await getEvidenceBucket().delete(storedKey); } catch { /* Preserve the primary error; orphan cleanup is best effort. */ }
    }
    return jsonError(error);
  }
}
