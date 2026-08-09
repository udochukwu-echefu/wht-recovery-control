import { getD1 } from ".";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS evidence_documents (
    id TEXT PRIMARY KEY NOT NULL, r2_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
    kind TEXT NOT NULL, status TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0,
    ai_model TEXT, ai_response_id TEXT, error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS recovery_cases (
    id TEXT PRIMARY KEY NOT NULL, customer TEXT NOT NULL, customer_tin TEXT NOT NULL DEFAULT '',
    invoice_reference TEXT NOT NULL, invoice_gross_kobo INTEGER NOT NULL,
    payment_net_kobo INTEGER NOT NULL, expected_wht_kobo INTEGER NOT NULL,
    reporting_period TEXT NOT NULL DEFAULT '', receipt_number TEXT, receipt_amount_kobo INTEGER,
    receipt_beneficiary_tin TEXT, stage TEXT NOT NULL DEFAULT 'detected',
    exception_code TEXT NOT NULL DEFAULT 'RECEIPT_MISSING', confidence INTEGER NOT NULL DEFAULT 0,
    source_document_id TEXT, rule_version TEXT NOT NULL DEFAULT '2026.07',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS extracted_fields (
    id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, field_name TEXT NOT NULL,
    extracted_value TEXT NOT NULL DEFAULT '', reviewed_value TEXT, confidence INTEGER NOT NULL DEFAULT 0,
    evidence_quote TEXT NOT NULL DEFAULT '', page_number INTEGER, reviewed_at TEXT,
    FOREIGN KEY (document_id) REFERENCES evidence_documents(id)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY NOT NULL, case_id TEXT, document_id TEXT, event_type TEXT NOT NULL,
    actor TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_evidence_documents_created ON evidence_documents(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_recovery_cases_invoice ON recovery_cases(invoice_reference)",
  "CREATE INDEX IF NOT EXISTS idx_recovery_cases_stage_updated ON recovery_cases(stage, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_extracted_fields_document ON extracted_fields(document_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_events_case_created ON audit_events(case_id, created_at)",
] as const;

export async function ensureSchema() {
  const d1 = getD1();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
}
