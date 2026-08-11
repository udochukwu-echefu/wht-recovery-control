import { eq } from "drizzle-orm";
import { getD1, getDb, getEvidenceObjectText } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { aiJobs, auditEvents, evidenceDocuments, ledgerImports, recoveryCases } from "@/db/schema";
import { parseLedgerCsvWithMapping, validateLedgerMapping, type ConfirmedMapping } from "@/lib/csv";

export const runtime = "edge";

type LedgerAction = { importId: string; action: "validate" | "import"; mappings?: ConfirmedMapping[] };

function isLedgerAction(value: unknown): value is LedgerAction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.importId !== "string" || !["validate", "import"].includes(String(item.action))) return false;
  if (item.mappings !== undefined && (!Array.isArray(item.mappings) || item.mappings.some((mapping) => !mapping || typeof mapping !== "object" || typeof (mapping as Record<string, unknown>).sourceColumn !== "string" || typeof (mapping as Record<string, unknown>).targetField !== "string"))) return false;
  return true;
}

async function loadImport(importId: string) {
  const db = getDb();
  const ledger = (await db.select().from(ledgerImports).where(eq(ledgerImports.id, importId)).limit(1))[0];
  if (!ledger) return null;
  const document = (await db.select().from(evidenceDocuments).where(eq(evidenceDocuments.id, ledger.documentId)).limit(1))[0];
  if (!document) return null;
  const csv = await getEvidenceObjectText(document.r2Key);
  if (csv === null) throw new Error("The original ledger file is unavailable.");
  return { ledger, document, csv };
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const payload: unknown = await request.json();
    if (!isLedgerAction(payload) || !payload.importId.trim()) return Response.json({ error: "A valid ledger workflow action is required." }, { status: 400 });
    const loaded = await loadImport(payload.importId);
    if (!loaded) return Response.json({ error: "Ledger import session not found." }, { status: 404 });
    if (loaded.ledger.status === "imported") return Response.json({ error: "This ledger has already been imported." }, { status: 409 });
    const db = getDb();

    if (payload.action === "validate") {
      const mappings = payload.mappings ?? [];
      const headers = JSON.parse(loaded.ledger.headersJson) as string[];
      const mappingCheck = validateLedgerMapping(headers, mappings);
      const parsed = mappingCheck.valid ? parseLedgerCsvWithMapping(loaded.csv, mappings) : { rows: [], errors: mappingCheck.errors, warnings: [], duplicateSourceIdentities: [] };
      const existing = await db.select({ customer: recoveryCases.customer, invoiceReference: recoveryCases.invoiceReference }).from(recoveryCases).limit(2_000);
      const existingIdentities = new Set(existing.map((item) => `${item.customer.toLowerCase().replace(/[^a-z0-9]/g, "")}:${item.invoiceReference.toLowerCase().replace(/[^a-z0-9]/g, "")}`));
      const existingDuplicates = parsed.rows.filter((row) => existingIdentities.has(row.sourceIdentity)).map((row) => `Row ${row.sourceRow}: ${row.customer} / ${row.invoiceReference} already exists.`);
      const errors = [...parsed.errors, ...existingDuplicates];
      const validation = { valid: errors.length === 0 && parsed.rows.length > 0, validRows: parsed.rows.length, rejectedRows: errors.filter((error) => error.startsWith("Row ")).length, errors, warnings: parsed.warnings, deterministicCalculation: "expected_wht_kobo = supplied expected WHT only when it equals invoice gross minus payment net; otherwise the payment gap is stored" };
      const now = new Date().toISOString();
      await db.update(ledgerImports).set({ status: validation.valid ? "ready_to_import" : "validation_failed", mappingJson: JSON.stringify(mappings), validationJson: JSON.stringify(validation), confirmedBy: "reviewer", confirmedAt: now }).where(eq(ledgerImports.id, payload.importId));
      await db.insert(auditEvents).values({ id: crypto.randomUUID(), documentId: loaded.document.id, eventType: "LEDGER_MAPPING_CONFIRMED", actor: "reviewer", detailJson: JSON.stringify({ importId: payload.importId, mappings, validation, confirmedAt: now }) });
      if (loaded.ledger.aiJobId) await db.update(aiJobs).set({ humanCorrection: JSON.stringify({ confirmedMapping: mappings, confirmedBy: "reviewer", confirmedAt: now }) }).where(eq(aiJobs.id, loaded.ledger.aiJobId));
      return Response.json({ importId: payload.importId, status: validation.valid ? "ready_to_import" : "validation_failed", validation });
    }

    if (loaded.ledger.status !== "ready_to_import") return Response.json({ error: "Confirm the mapping and pass deterministic validation before import." }, { status: 409 });
    const mappings = JSON.parse(loaded.ledger.mappingJson) as ConfirmedMapping[];
    const parsed = parseLedgerCsvWithMapping(loaded.csv, mappings);
    if (parsed.errors.length || !parsed.rows.length) return Response.json({ error: "The ledger no longer passes deterministic validation.", errors: parsed.errors }, { status: 409 });
    const now = new Date().toISOString();
    const d1 = getD1();
    const statements = [];
    const createdCases: Array<{ id: string; customer: string; invoiceReference: string; expectedWhtKobo: number }> = [];
    for (const row of parsed.rows) {
      const caseId = `WHT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      createdCases.push({ id: caseId, customer: row.customer, invoiceReference: row.invoiceReference, expectedWhtKobo: row.expectedWhtKobo });
      statements.push(d1.prepare("INSERT INTO recovery_cases (id, customer, customer_tin, invoice_reference, invoice_gross_kobo, payment_net_kobo, expected_wht_kobo, reporting_period, stage, exception_code, confidence, source_document_id, rule_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'detected', 'RECEIPT_MISSING', 0, ?, '2026.07', ?, ?)").bind(caseId, row.customer, row.customerTin, row.invoiceReference, row.invoiceGrossKobo, row.paymentNetKobo, row.expectedWhtKobo, row.reportingPeriod, loaded.document.id, now, now));
      statements.push(d1.prepare("INSERT INTO case_sources (id, case_id, document_id, ledger_import_id, source_row, source_identity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), caseId, loaded.document.id, payload.importId, row.sourceRow, row.sourceIdentity, now));
      statements.push(d1.prepare("INSERT INTO audit_events (id, case_id, document_id, event_type, actor, detail_json, created_at) VALUES (?, ?, ?, 'CASE_CREATED', 'system', ?, ?)").bind(crypto.randomUUID(), caseId, loaded.document.id, JSON.stringify({ sourceRow: row.sourceRow, ledgerImportId: payload.importId, deterministicExpectedWhtKobo: row.expectedWhtKobo, ruleVersion: "2026.07" }), now));
    }
    statements.push(d1.prepare("UPDATE ledger_imports SET status = 'imported', imported_at = ? WHERE id = ?").bind(now, payload.importId));
    statements.push(d1.prepare("UPDATE evidence_documents SET status = 'imported', row_count = ? WHERE id = ?").bind(parsed.rows.length, loaded.document.id));
    statements.push(d1.prepare("INSERT INTO audit_events (id, document_id, event_type, actor, detail_json, created_at) VALUES (?, ?, 'LEDGER_IMPORTED', 'reviewer', ?, ?)").bind(crypto.randomUUID(), loaded.document.id, JSON.stringify({ importId: payload.importId, caseCount: parsed.rows.length, caseIds: createdCases.map((item) => item.id) }), now));
    await d1.batch(statements);
    return Response.json({ importId: payload.importId, status: "imported", importedCases: parsed.rows.length, cases: createdCases }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected ledger workflow error.";
    console.error(JSON.stringify({ message: "ledger workflow failed", category: "LEDGER_WORKFLOW_ERROR" }));
    return Response.json({ error: message.includes("unavailable") ? message : "The ledger workflow could not be completed." }, { status: 500 });
  }
}
