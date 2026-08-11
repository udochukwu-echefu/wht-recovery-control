import { getD1 } from ".";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS evidence_blobs (
    storage_key TEXT PRIMARY KEY NOT NULL, bytes BLOB NOT NULL, content_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
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
  `CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL DEFAULT 'pilot-workspace',
    case_id TEXT, document_id TEXT, task_type TEXT NOT NULL, status TEXT NOT NULL,
    provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
    input_hash TEXT NOT NULL, output_json TEXT, confidence INTEGER,
    source_references_json TEXT NOT NULL DEFAULT '[]', latency_ms INTEGER,
    validation_outcome TEXT NOT NULL DEFAULT 'pending', human_correction TEXT,
    error_code TEXT, error_message TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_imports (
    id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, status TEXT NOT NULL,
    headers_json TEXT NOT NULL, preview_json TEXT NOT NULL, detected_types_json TEXT NOT NULL,
    mapping_json TEXT NOT NULL DEFAULT '[]', warnings_json TEXT NOT NULL DEFAULT '[]',
    validation_json TEXT NOT NULL DEFAULT '{}', ai_job_id TEXT, confirmed_by TEXT,
    confirmed_at TEXT, imported_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES evidence_documents(id)
  )`,
  `CREATE TABLE IF NOT EXISTS case_sources (
    id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, document_id TEXT NOT NULL,
    ledger_import_id TEXT, source_row INTEGER NOT NULL, source_identity TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES recovery_cases(id),
    FOREIGN KEY (document_id) REFERENCES evidence_documents(id),
    FOREIGN KEY (ledger_import_id) REFERENCES ledger_imports(id)
  )`,
  `CREATE TABLE IF NOT EXISTS document_intelligence (
    document_id TEXT PRIMARY KEY NOT NULL, classification_json TEXT NOT NULL DEFAULT '{}',
    duplicate_json TEXT NOT NULL DEFAULT '{}', text_status TEXT NOT NULL DEFAULT 'uploaded',
    provider TEXT, model TEXT, prompt_version TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES evidence_documents(id)
  )`,
  `CREATE TABLE IF NOT EXISTS candidate_matches (
    id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, case_id TEXT NOT NULL,
    rank INTEGER NOT NULL, confidence INTEGER NOT NULL, reasons_json TEXT NOT NULL DEFAULT '[]',
    conflicts_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'suggested',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES evidence_documents(id),
    FOREIGN KEY (case_id) REFERENCES recovery_cases(id)
  )`,
  `CREATE TABLE IF NOT EXISTS match_executions (
    id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, document_id TEXT NOT NULL,
    rule_version TEXT NOT NULL, result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES recovery_cases(id),
    FOREIGN KEY (document_id) REFERENCES evidence_documents(id)
  )`,
  `CREATE TABLE IF NOT EXISTS recovery_plans (
    id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'suggested',
    plan_json TEXT NOT NULL, ai_job_id TEXT, reviewer_note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, accepted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS communication_drafts (
    id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, draft_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'generated', subject TEXT NOT NULL, body TEXT NOT NULL,
    ai_job_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT, copied_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_evidence_documents_created ON evidence_documents(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_recovery_cases_invoice ON recovery_cases(invoice_reference)",
  "CREATE INDEX IF NOT EXISTS idx_recovery_cases_stage_updated ON recovery_cases(stage, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_extracted_fields_document ON extracted_fields(document_id)",
  "CREATE INDEX IF NOT EXISTS idx_audit_events_case_created ON audit_events(case_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ai_jobs_created ON ai_jobs(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ai_jobs_task_status ON ai_jobs(task_type, status)",
  "CREATE INDEX IF NOT EXISTS idx_ai_jobs_case_created ON ai_jobs(case_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_ledger_imports_document ON ledger_imports(document_id)",
  "CREATE INDEX IF NOT EXISTS idx_case_sources_case ON case_sources(case_id)",
  "CREATE INDEX IF NOT EXISTS idx_candidate_matches_document_rank ON candidate_matches(document_id, rank)",
  "CREATE INDEX IF NOT EXISTS idx_match_executions_case_created ON match_executions(case_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_recovery_plans_case_created ON recovery_plans(case_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_communication_drafts_case_created ON communication_drafts(case_id, created_at)",
  `CREATE TRIGGER IF NOT EXISTS audit_events_no_update
    BEFORE UPDATE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
    BEFORE DELETE ON audit_events
    BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END`,
] as const;

export async function ensureSchema() {
  const d1 = getD1();
  await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
}
