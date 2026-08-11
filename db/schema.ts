import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const recoveryCases = sqliteTable(
  "recovery_cases",
  {
    id: text("id").primaryKey(),
    customer: text("customer").notNull(),
    customerTin: text("customer_tin").notNull().default(""),
    invoiceReference: text("invoice_reference").notNull(),
    invoiceGrossKobo: integer("invoice_gross_kobo").notNull(),
    paymentNetKobo: integer("payment_net_kobo").notNull(),
    expectedWhtKobo: integer("expected_wht_kobo").notNull(),
    reportingPeriod: text("reporting_period").notNull().default(""),
    receiptNumber: text("receipt_number"),
    receiptAmountKobo: integer("receipt_amount_kobo"),
    receiptBeneficiaryTin: text("receipt_beneficiary_tin"),
    stage: text("stage").notNull().default("detected"),
    exceptionCode: text("exception_code").notNull().default("RECEIPT_MISSING"),
    confidence: integer("confidence").notNull().default(0),
    sourceDocumentId: text("source_document_id"),
    ruleVersion: text("rule_version").notNull().default("2026.07"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_recovery_cases_invoice").on(table.invoiceReference),
    index("idx_recovery_cases_stage_updated").on(table.stage, table.updatedAt),
  ],
);

export const evidenceDocuments = sqliteTable(
  "evidence_documents",
  {
    id: text("id").primaryKey(),
    r2Key: text("r2_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    aiModel: text("ai_model"),
    aiResponseId: text("ai_response_id"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_evidence_documents_created").on(table.createdAt)],
);

export const extractedFields = sqliteTable(
  "extracted_fields",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => evidenceDocuments.id),
    fieldName: text("field_name").notNull(),
    extractedValue: text("extracted_value").notNull().default(""),
    reviewedValue: text("reviewed_value"),
    confidence: integer("confidence").notNull().default(0),
    evidenceQuote: text("evidence_quote").notNull().default(""),
    pageNumber: integer("page_number"),
    reviewedAt: text("reviewed_at"),
  },
  (table) => [index("idx_extracted_fields_document").on(table.documentId)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id"),
    documentId: text("document_id"),
    eventType: text("event_type").notNull(),
    actor: text("actor").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_audit_events_case_created").on(table.caseId, table.createdAt)],
);

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("pilot-workspace"),
    caseId: text("case_id"),
    documentId: text("document_id"),
    taskType: text("task_type").notNull(),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputJson: text("output_json"),
    confidence: integer("confidence"),
    sourceReferencesJson: text("source_references_json").notNull().default("[]"),
    latencyMs: integer("latency_ms"),
    validationOutcome: text("validation_outcome").notNull().default("pending"),
    humanCorrection: text("human_correction"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_ai_jobs_created").on(table.createdAt),
    index("idx_ai_jobs_task_status").on(table.taskType, table.status),
    index("idx_ai_jobs_case_created").on(table.caseId, table.createdAt),
  ],
);

export const ledgerImports = sqliteTable(
  "ledger_imports",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => evidenceDocuments.id),
    status: text("status").notNull(),
    headersJson: text("headers_json").notNull(),
    previewJson: text("preview_json").notNull(),
    detectedTypesJson: text("detected_types_json").notNull(),
    mappingJson: text("mapping_json").notNull().default("[]"),
    warningsJson: text("warnings_json").notNull().default("[]"),
    validationJson: text("validation_json").notNull().default("{}"),
    aiJobId: text("ai_job_id"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: text("confirmed_at"),
    importedAt: text("imported_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_ledger_imports_document").on(table.documentId)],
);

export const caseSources = sqliteTable(
  "case_sources",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull().references(() => recoveryCases.id),
    documentId: text("document_id").notNull().references(() => evidenceDocuments.id),
    ledgerImportId: text("ledger_import_id").references(() => ledgerImports.id),
    sourceRow: integer("source_row").notNull(),
    sourceIdentity: text("source_identity").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_case_sources_case").on(table.caseId)],
);

export const documentIntelligence = sqliteTable(
  "document_intelligence",
  {
    documentId: text("document_id").primaryKey().references(() => evidenceDocuments.id),
    classificationJson: text("classification_json").notNull().default("{}"),
    duplicateJson: text("duplicate_json").notNull().default("{}"),
    textStatus: text("text_status").notNull().default("uploaded"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const candidateMatches = sqliteTable(
  "candidate_matches",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => evidenceDocuments.id),
    caseId: text("case_id").notNull().references(() => recoveryCases.id),
    rank: integer("rank").notNull(),
    confidence: integer("confidence").notNull(),
    reasonsJson: text("reasons_json").notNull().default("[]"),
    conflictsJson: text("conflicts_json").notNull().default("[]"),
    status: text("status").notNull().default("suggested"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_candidate_matches_document_rank").on(table.documentId, table.rank)],
);

export const matchExecutions = sqliteTable(
  "match_executions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull().references(() => recoveryCases.id),
    documentId: text("document_id").notNull().references(() => evidenceDocuments.id),
    ruleVersion: text("rule_version").notNull(),
    resultJson: text("result_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_match_executions_case_created").on(table.caseId, table.createdAt)],
);

export const recoveryPlans = sqliteTable(
  "recovery_plans",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    status: text("status").notNull().default("suggested"),
    planJson: text("plan_json").notNull(),
    aiJobId: text("ai_job_id"),
    reviewerNote: text("reviewer_note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    acceptedAt: text("accepted_at"),
  },
  (table) => [index("idx_recovery_plans_case_created").on(table.caseId, table.createdAt)],
);

export const communicationDrafts = sqliteTable(
  "communication_drafts",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    draftType: text("draft_type").notNull(),
    status: text("status").notNull().default("generated"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    aiJobId: text("ai_job_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    approvedAt: text("approved_at"),
    copiedAt: text("copied_at"),
  },
  (table) => [index("idx_communication_drafts_case_created").on(table.caseId, table.createdAt)],
);
