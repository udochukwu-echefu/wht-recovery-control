import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditEvents, clients, evidenceDocuments, extractedFields, recoveryCases } from "@/db/schema";
import { evaluateReceiptMatch, type ReceiptExtraction } from "@/lib/matching";
import { apiError, requireContext, type RequestContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

const allowedActions = new Set(["review-extraction", "recognise", "close"]);
const permittedFields = new Set([
  "customer_name",
  "deducting_customer_tin",
  "beneficiary_tin",
  "invoice_reference",
  "receipt_number",
  "wht_amount",
  "reporting_period",
]);

type ReviewPayload = {
  caseId: string;
  action: "review-extraction" | "recognise" | "close";
  corrections?: Record<string, string>;
  note?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReviewPayload(value: unknown): value is ReviewPayload {
  if (!isRecord(value) || typeof value.caseId !== "string" || typeof value.action !== "string") return false;
  if (!allowedActions.has(value.action)) return false;
  if (value.note !== undefined && typeof value.note !== "string") return false;
  if (value.corrections !== undefined && (!isRecord(value.corrections) || Object.values(value.corrections).some((item) => typeof item !== "string"))) return false;
  return true;
}

function cleanValue(fieldName: string, value: string) {
  const trimmed = value.trim();
  const limits: Record<string, number> = {
    customer_name: 180,
    deducting_customer_tin: 40,
    beneficiary_tin: 40,
    invoice_reference: 80,
    receipt_number: 80,
    wht_amount: 30,
    reporting_period: 80,
  };
  if (trimmed.length > (limits[fieldName] ?? 180)) throw new Error(`${fieldName} is too long.`);
  if (fieldName === "wht_amount" && trimmed && !/^\d+(?:\.\d{1,2})?$/.test(trimmed.replaceAll(",", ""))) {
    throw new Error("WHT amount must be a positive number with no currency symbol.");
  }
  return trimmed;
}

function koboFromText(value: string) {
  const normalized = value.trim().replaceAll(",", "");
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

async function loadCase(context: RequestContext, caseId: string) {
  return (await getDb().select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id))).limit(1))[0] ?? null;
}

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId")?.trim();
  if (!caseId) return Response.json({ error: "caseId is required." }, { status: 400 });

  try {
    await ensureSchema();
    const context = await requireContext(request);
    const recoveryCase = await loadCase(context, caseId);
    if (!recoveryCase) return Response.json({ error: "Case not found." }, { status: 404 });
    if (!recoveryCase.sourceDocumentId) {
      return Response.json({ error: "This case does not have an AI-extracted receipt to review." }, { status: 404 });
    }

    const db = getDb();
    const [document, fields, reviewEvents] = await Promise.all([
      db.select({
        id: evidenceDocuments.id,
        fileName: evidenceDocuments.fileName,
        sha256: evidenceDocuments.sha256,
        aiModel: evidenceDocuments.aiModel,
        aiResponseId: evidenceDocuments.aiResponseId,
        createdAt: evidenceDocuments.createdAt,
      }).from(evidenceDocuments).where(and(eq(evidenceDocuments.id, recoveryCase.sourceDocumentId), eq(evidenceDocuments.workspaceId, context.workspace.id))).limit(1),
      db.select().from(extractedFields).where(and(eq(extractedFields.documentId, recoveryCase.sourceDocumentId), eq(extractedFields.workspaceId, context.workspace.id))),
      db.select({ id: auditEvents.id, createdAt: auditEvents.createdAt, detailJson: auditEvents.detailJson })
        .from(auditEvents)
        .where(and(
          eq(auditEvents.caseId, caseId),
          eq(auditEvents.workspaceId, context.workspace.id),
          eq(auditEvents.documentId, recoveryCase.sourceDocumentId),
          eq(auditEvents.eventType, "EXTRACTION_REVIEW_COMPLETED"),
        ))
        .orderBy(desc(auditEvents.createdAt))
        .limit(1),
    ]);

    return Response.json({
      caseId,
      ruleVersion: recoveryCase.ruleVersion,
      document: document[0] ?? null,
      fields: fields.map((field) => ({
        id: field.id,
        fieldName: field.fieldName,
        originalValue: field.extractedValue,
        reviewedValue: field.reviewedValue,
        effectiveValue: field.reviewedValue ?? field.extractedValue,
        confidence: field.confidence,
        evidenceQuote: field.evidenceQuote,
        pageNumber: field.pageNumber,
        editable: permittedFields.has(field.fieldName),
      })),
      review: reviewEvents[0]
        ? { completed: true, eventId: reviewEvents[0].id, createdAt: reviewEvents[0].createdAt, detail: JSON.parse(reviewEvents[0].detailJson) }
        : { completed: false },
    });
  } catch (error) {
    return apiError(error, "Extraction review data is unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const payload: unknown = await request.json();
    if (!isReviewPayload(payload) || !payload.caseId.trim()) {
      return Response.json({ error: "A valid caseId and review action are required." }, { status: 400 });
    }

    const recoveryCase = await loadCase(context, payload.caseId);
    if (!recoveryCase) return Response.json({ error: "Case not found." }, { status: 404 });

    if (payload.action === "review-extraction") {
      if (!recoveryCase.sourceDocumentId) return Response.json({ error: "No extracted receipt is linked to this case." }, { status: 409 });
      const fields = await getDb().select().from(extractedFields).where(and(eq(extractedFields.documentId, recoveryCase.sourceDocumentId), eq(extractedFields.workspaceId, context.workspace.id)));
      if (!fields.length) return Response.json({ error: "No extracted fields are available for review." }, { status: 409 });

      const corrections = payload.corrections ?? {};
      const unknownField = Object.keys(corrections).find((name) => !permittedFields.has(name));
      if (unknownField) return Response.json({ error: `${unknownField} is not editable.` }, { status: 400 });

      const originals = Object.fromEntries(fields.map((field) => [field.fieldName, field.extractedValue]));
      const currentValues = Object.fromEntries(fields.map((field) => [field.fieldName, field.reviewedValue ?? field.extractedValue]));
      const cleanedCorrections = Object.fromEntries(Object.entries(corrections).map(([name, value]) => [name, cleanValue(name, String(value))]));
      const effectiveValues = { ...currentValues, ...cleanedCorrections };
      const changes = Object.entries(cleanedCorrections)
        .filter(([name, value]) => value !== currentValues[name])
        .map(([fieldName, after]) => ({ fieldName, before: currentValues[fieldName] ?? "", after }));
      const note = payload.note?.trim().slice(0, 500) ?? "";
      if (changes.length && note.length < 10) {
        return Response.json({ error: "Add a review note of at least 10 characters to explain field corrections." }, { status: 400 });
      }

      const extraction: ReceiptExtraction = {
        customerName: effectiveValues.customer_name ?? "",
        deductingCustomerTin: effectiveValues.deducting_customer_tin ?? "",
        beneficiaryTin: effectiveValues.beneficiary_tin ?? "",
        invoiceReference: effectiveValues.invoice_reference ?? "",
        receiptNumber: effectiveValues.receipt_number ?? "",
        whtAmountKobo: koboFromText(effectiveValues.wht_amount ?? ""),
        reportingPeriod: effectiveValues.reporting_period ?? "",
        fields: Object.fromEntries(fields.map((field) => [field.fieldName, {
          confidence: field.confidence,
          evidenceQuote: field.evidenceQuote,
          pageNumber: field.pageNumber,
        }])),
      };
      const activeRules = await getActiveRuleSet(context, recoveryCase.businessDate ?? undefined);
      const client = (await getDb().select({ tin: clients.tin }).from(clients).where(and(eq(clients.id, context.clientId), eq(clients.workspaceId, context.workspace.id))).limit(1))[0];
      const outcome = evaluateReceiptMatch(extraction, {
        id: recoveryCase.id,
        customer: recoveryCase.customer,
        customerTin: recoveryCase.customerTin,
        invoiceReference: recoveryCase.invoiceReference,
        expectedWhtKobo: recoveryCase.expectedWhtKobo,
        reportingPeriod: recoveryCase.reportingPeriod,
        beneficiaryTin: client?.tin ?? "",
      }, { version: activeRules.version, amountToleranceKobo: activeRules.toleranceAmountKobo });
      const now = new Date().toISOString();
      const eventId = crypto.randomUUID();
      const d1 = getD1();
      const statements = [
        ...changes.map((change) => d1.prepare("UPDATE extracted_fields SET reviewed_value = ?, reviewed_at = ?, reviewed_by_user_id = ? WHERE workspace_id = ? AND document_id = ? AND field_name = ?")
          .bind(change.after, now, context.user.id, context.workspace.id, recoveryCase.sourceDocumentId, change.fieldName)),
        d1.prepare("INSERT INTO audit_events (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(eventId, context.workspace.id, recoveryCase.id, recoveryCase.sourceDocumentId, "EXTRACTION_REVIEW_COMPLETED", "user", context.user.id, context.user.displayName, context.workspace.role, JSON.stringify({
            note,
            changes,
            originalExtraction: originals,
            effectiveExtraction: effectiveValues,
            provenance: fields.map((field) => ({ fieldName: field.fieldName, confidence: field.confidence, evidenceQuote: field.evidenceQuote, pageNumber: field.pageNumber })),
            outcome,
            ruleVersion: activeRules.version,
          }), now),
        d1.prepare("INSERT INTO match_executions (id, workspace_id, case_id, document_id, rule_version, result_json, factors_json, conflicts_json, tolerance_json, created_at) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?)")
          .bind(crypto.randomUUID(), context.workspace.id, recoveryCase.id, recoveryCase.sourceDocumentId, activeRules.version, JSON.stringify(outcome), JSON.stringify({ amountKobo: activeRules.toleranceAmountKobo }), now),
        d1.prepare("UPDATE recovery_cases SET receipt_number = ?, receipt_amount_kobo = ?, receipt_beneficiary_tin = ?, stage = ?, exception_code = ?, confidence = ?, rule_version = ?, next_action = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
          .bind(extraction.receiptNumber || null, extraction.whtAmountKobo, extraction.beneficiaryTin || null, outcome.stage, outcome.exceptionCode, outcome.confidence, activeRules.version, outcome.exceptionCode === "NO_OPEN_EXCEPTION" ? "Connect and verify authority record" : "Resolve receipt mismatch", now, recoveryCase.id, context.workspace.id),
        d1.prepare("UPDATE receipt_records SET receipt_reference = ?, deducting_customer_tin = ?, beneficiary_tin = ?, amount_kobo = ?, reporting_period = ?, status = 'reviewed', extraction_reviewed_at = ?, extraction_reviewed_by = ? WHERE document_id = ? AND workspace_id = ?")
          .bind(extraction.receiptNumber || null, extraction.deductingCustomerTin || null, extraction.beneficiaryTin || null, extraction.whtAmountKobo, extraction.reportingPeriod || null, now, context.user.id, recoveryCase.sourceDocumentId, context.workspace.id),
      ];
      await d1.batch(statements);

      return Response.json({
        caseId: recoveryCase.id,
        eventId,
        reviewedAt: now,
        changes,
        effectiveValues,
        outcome,
        recognitionEligible: outcome.exceptionCode === "NO_OPEN_EXCEPTION",
      });
    }

    if (payload.action === "recognise") {
      if (!recoveryCase.sourceDocumentId) return Response.json({ error: "No reviewed receipt is linked to this case." }, { status: 409 });
      const reviewEvent = await getDb().select({ id: auditEvents.id }).from(auditEvents)
        .where(and(
          eq(auditEvents.caseId, recoveryCase.id),
          eq(auditEvents.workspaceId, context.workspace.id),
          eq(auditEvents.documentId, recoveryCase.sourceDocumentId),
          eq(auditEvents.eventType, "EXTRACTION_REVIEW_COMPLETED"),
        ))
        .orderBy(desc(auditEvents.createdAt)).limit(1);
      if (!reviewEvent.length) return Response.json({ error: "Review the extracted fields and record the audit checkpoint before recognition." }, { status: 409 });
      const authorityAllocation = await getD1().prepare("SELECT id FROM authority_allocations WHERE workspace_id = ? AND case_id = ? AND result_code IN ('matched', 'matched_within_tolerance') ORDER BY created_at DESC LIMIT 1")
        .bind(context.workspace.id, recoveryCase.id).first<{ id: string }>();
      if (!authorityAllocation) return Response.json({ error: "Recognition is blocked until an authority record is connected and verified." }, { status: 409 });
      if (recoveryCase.applicabilityStatus !== "confirmed_applicable") return Response.json({ error: "Recognition is blocked until WHT applicability is confirmed." }, { status: 409 });
      if (recoveryCase.exceptionCode !== "NO_OPEN_EXCEPTION") {
        return Response.json({ error: "Recognition is blocked until deterministic matching has no open exception." }, { status: 409 });
      }
      const now = new Date().toISOString();
      await getD1().batch([
        getD1().prepare("INSERT INTO audit_events (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), context.workspace.id, recoveryCase.id, recoveryCase.sourceDocumentId, "REVIEW_DECISION", context.user.id, context.user.displayName, context.workspace.role, JSON.stringify({ stage: "recognised", reviewEventId: reviewEvent[0].id, authorityAllocationId: authorityAllocation.id, note: payload.note?.trim().slice(0, 500) ?? "" }), now),
        getD1().prepare("UPDATE recovery_cases SET stage = ?, next_action = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").bind("recognised", "Record utilisation when applied", now, recoveryCase.id, context.workspace.id),
      ]);
      return Response.json({ caseId: recoveryCase.id, stage: "recognised", updatedAt: now });
    }

    if (recoveryCase.stage !== "recognised") return Response.json({ error: "Only a recognised case can be closed as utilised." }, { status: 409 });
    const now = new Date().toISOString();
    await getD1().batch([
      getD1().prepare("INSERT INTO audit_events (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), context.workspace.id, recoveryCase.id, recoveryCase.sourceDocumentId, "REVIEW_DECISION", context.user.id, context.user.displayName, context.workspace.role, JSON.stringify({ stage: "closed", note: payload.note?.trim().slice(0, 500) ?? "" }), now),
      getD1().prepare("UPDATE recovery_cases SET stage = ?, next_action = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?").bind("closed", now, recoveryCase.id, context.workspace.id),
    ]);
    return Response.json({ caseId: recoveryCase.id, stage: "closed", updatedAt: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected review error.";
    console.error(JSON.stringify({ message: "review failed", error: message }));
    const isInputError = message.endsWith("is too long.") || message.startsWith("WHT amount");
    if (isInputError) return Response.json({ error: message }, { status: 400 });
    return apiError(error, "The review action could not be saved.");
  }
}
