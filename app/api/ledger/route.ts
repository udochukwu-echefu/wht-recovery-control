import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { aiJobs, evidenceDocuments, ledgerImports, recoveryCases } from "@/db/schema";
import { parseLedgerCsvWithMapping, validateLedgerMapping, type ConfirmedMapping } from "@/lib/csv";
import { apiError, auditStatement, requireContext, type RequestContext } from "@/lib/auth";
import { getStoredObjectText } from "@/lib/storage";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

type LedgerAction = { importId: string; action: "validate" | "import"; mappings?: ConfirmedMapping[] };

function isLedgerAction(value: unknown): value is LedgerAction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.importId !== "string" || !["validate", "import"].includes(String(item.action))) return false;
  if (item.mappings !== undefined && (!Array.isArray(item.mappings) || item.mappings.some((mapping) => !mapping || typeof mapping !== "object" || typeof (mapping as Record<string, unknown>).sourceColumn !== "string" || typeof (mapping as Record<string, unknown>).targetField !== "string"))) return false;
  return true;
}

async function loadImport(context: RequestContext, importId: string) {
  const db = getDb();
  const ledger = (await db.select().from(ledgerImports).where(and(eq(ledgerImports.id, importId), eq(ledgerImports.workspaceId, context.workspace.id))).limit(1))[0];
  if (!ledger) return null;
  const document = (await db.select().from(evidenceDocuments).where(and(eq(evidenceDocuments.id, ledger.documentId), eq(evidenceDocuments.workspaceId, context.workspace.id))).limit(1))[0];
  if (!document) return null;
  const csv = await getStoredObjectText(context, document.storageKey);
  if (csv === null) throw new Error("The original ledger file is unavailable.");
  return { ledger, document, csv };
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const payload: unknown = await request.json();
    if (!isLedgerAction(payload) || !payload.importId.trim()) return Response.json({ error: "A valid ledger workflow action is required." }, { status: 400 });
    const loaded = await loadImport(context, payload.importId);
    if (!loaded) return Response.json({ error: "Ledger import session not found." }, { status: 404 });
    if (loaded.ledger.status === "imported") return Response.json({ error: "This ledger has already been imported." }, { status: 409 });
    const db = getDb();

    if (payload.action === "validate") {
      const mappings = payload.mappings ?? [];
      const headers = JSON.parse(loaded.ledger.headersJson) as string[];
      const mappingCheck = validateLedgerMapping(headers, mappings);
      const parsed = mappingCheck.valid ? parseLedgerCsvWithMapping(loaded.csv, mappings) : { rows: [], errors: mappingCheck.errors, warnings: [], duplicateSourceIdentities: [] };
      const existing = await db.select({ customer: recoveryCases.customer, invoiceReference: recoveryCases.invoiceReference }).from(recoveryCases).where(and(eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId))).limit(2_000);
      const existingIdentities = new Set(existing.map((item) => `${item.customer.toLowerCase().replace(/[^a-z0-9]/g, "")}:${item.invoiceReference.toLowerCase().replace(/[^a-z0-9]/g, "")}`));
      const existingDuplicates = parsed.rows.filter((row) => existingIdentities.has(row.sourceIdentity)).map((row) => `Row ${row.sourceRow}: ${row.customer} / ${row.invoiceReference} already exists.`);
      const errors = [...parsed.errors, ...existingDuplicates];
      const validation = { valid: errors.length === 0 && parsed.rows.length > 0, validRows: parsed.rows.length, rejectedRows: errors.filter((error) => error.startsWith("Row ")).length, errors, warnings: parsed.warnings, deterministicCalculation: "expected_wht_kobo = supplied expected WHT only when it equals invoice gross minus payment net; otherwise the payment gap is stored" };
      const now = new Date().toISOString();
      await db.update(ledgerImports).set({ status: validation.valid ? "ready_to_import" : "validation_failed", mappingJson: JSON.stringify(mappings), validationJson: JSON.stringify(validation), confirmedBy: context.user.id, confirmedAt: now }).where(and(eq(ledgerImports.id, payload.importId), eq(ledgerImports.workspaceId, context.workspace.id)));
      await auditStatement(context, { documentId: loaded.document.id, eventType: "LEDGER_MAPPING_CONFIRMED", detail: { importId: payload.importId, mappings, validation, confirmedAt: now } }).run();
      if (loaded.ledger.aiJobId) await db.update(aiJobs).set({ humanCorrection: JSON.stringify({ confirmedMapping: mappings, confirmedByUserId: context.user.id, confirmedAt: now }) }).where(and(eq(aiJobs.id, loaded.ledger.aiJobId), eq(aiJobs.workspaceId, context.workspace.id)));
      return Response.json({ importId: payload.importId, status: validation.valid ? "ready_to_import" : "validation_failed", validation });
    }

    if (loaded.ledger.status !== "ready_to_import") return Response.json({ error: "Confirm the mapping and pass deterministic validation before import." }, { status: 409 });
    const mappings = JSON.parse(loaded.ledger.mappingJson) as ConfirmedMapping[];
    const parsed = parseLedgerCsvWithMapping(loaded.csv, mappings);
    if (parsed.errors.length || !parsed.rows.length) return Response.json({ error: "The ledger no longer passes deterministic validation.", errors: parsed.errors }, { status: 409 });
    const now = new Date().toISOString();
    const businessDate = parsed.rows.map((row) => row.paymentDate).filter(Boolean).sort().at(-1) ?? now.slice(0, 10);
    const ruleSet = await getActiveRuleSet(context, businessDate);
    const d1 = getD1();
    const statements = [];
    const createdCases: Array<{ id: string; customer: string; invoiceReference: string; expectedWhtKobo: number }> = [];
    for (const row of parsed.rows) {
      const caseId = `WHT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const customerId = crypto.randomUUID();
      const invoiceId = crypto.randomUUID();
      const paymentId = crypto.randomUUID();
      createdCases.push({ id: caseId, customer: row.customer, invoiceReference: row.invoiceReference, expectedWhtKobo: row.expectedWhtKobo });
      statements.push(d1.prepare("INSERT INTO customers (id, workspace_id, client_id, name, normalized_name, tin, source_document_id, source_row, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(customerId, context.workspace.id, context.clientId, row.customer, row.customer.toLowerCase().replace(/[^a-z0-9]/g, ""), row.customerTin, loaded.document.id, row.sourceRow, now, now));
      statements.push(d1.prepare("INSERT INTO invoices (id, workspace_id, client_id, customer_id, reference, gross_kobo, currency, status, source_document_id, source_row, source_identity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)").bind(invoiceId, context.workspace.id, context.clientId, customerId, row.invoiceReference, row.invoiceGrossKobo, row.currency, loaded.document.id, row.sourceRow, row.sourceIdentity, now, now));
      statements.push(d1.prepare("INSERT INTO payments (id, workspace_id, client_id, customer_id, reference, payment_date, amount_kobo, currency, status, source_document_id, source_row, source_identity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?)").bind(paymentId, context.workspace.id, context.clientId, customerId, `PAY-${row.invoiceReference}`, row.paymentDate, row.paymentNetKobo, row.currency, loaded.document.id, row.sourceRow, `${row.sourceIdentity}:payment`, now));
      statements.push(d1.prepare("INSERT INTO payment_allocations (id, workspace_id, payment_id, invoice_id, amount_kobo, status, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?)").bind(crypto.randomUUID(), context.workspace.id, paymentId, invoiceId, row.paymentNetKobo, now));
      statements.push(d1.prepare("INSERT INTO recovery_cases (id, workspace_id, client_id, customer, customer_tin, invoice_reference, invoice_gross_kobo, payment_net_kobo, expected_wht_kobo, reporting_period, stage, exception_code, confidence, source_document_id, rule_version, applicability_status, next_action, business_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'detected', 'APPLICABILITY_REVIEW_REQUIRED', 0, ?, ?, 'pending', 'Confirm WHT applicability', ?, ?, ?)").bind(caseId, context.workspace.id, context.clientId, row.customer, row.customerTin, row.invoiceReference, row.invoiceGrossKobo, row.paymentNetKobo, row.expectedWhtKobo, row.reportingPeriod, loaded.document.id, ruleSet.version, row.paymentDate, now, now));
      statements.push(d1.prepare("INSERT INTO case_sources (id, workspace_id, case_id, document_id, ledger_import_id, source_row, source_identity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), context.workspace.id, caseId, loaded.document.id, payload.importId, row.sourceRow, row.sourceIdentity, now));
      statements.push(auditStatement(context, { caseId, documentId: loaded.document.id, eventType: "CASE_CREATED", actor: "system", detail: { sourceRow: row.sourceRow, ledgerImportId: payload.importId, customerId, invoiceId, paymentId, deterministicPaymentGapKobo: row.expectedWhtKobo, ruleVersion: ruleSet.version, nextControl: "applicability_review" } }));
    }
    statements.push(d1.prepare("UPDATE ledger_imports SET status = 'imported', imported_at = ? WHERE id = ? AND workspace_id = ?").bind(now, payload.importId, context.workspace.id));
    statements.push(d1.prepare("UPDATE evidence_documents SET status = 'imported', row_count = ? WHERE id = ? AND workspace_id = ?").bind(parsed.rows.length, loaded.document.id, context.workspace.id));
    statements.push(auditStatement(context, { documentId: loaded.document.id, eventType: "LEDGER_IMPORTED", detail: { importId: payload.importId, caseCount: parsed.rows.length, caseIds: createdCases.map((item) => item.id), ruleVersion: ruleSet.version } }));
    await d1.batch(statements);
    return Response.json({ importId: payload.importId, status: "imported", importedCases: parsed.rows.length, cases: createdCases }, { status: 201 });
  } catch (error) {
    return apiError(error, "The ledger workflow could not be completed.");
  }
}
