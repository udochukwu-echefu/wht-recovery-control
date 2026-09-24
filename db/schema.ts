import { sql } from "drizzle-orm";
import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { recoveryCaseStages } from "@/lib/case-stage-policy";

export const recoveryCases = sqliteTable(
  "recovery_cases",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    clientId: text("client_id").notNull().default("local-client"),
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
    stage: text("stage", { enum: recoveryCaseStages }).notNull().default("detected"),
    exceptionCode: text("exception_code").notNull().default("RECEIPT_MISSING"),
    confidence: integer("confidence").notNull().default(0),
    sourceDocumentId: text("source_document_id"),
    ruleVersion: text("rule_version").notNull().default("2026.07"),
    applicabilityStatus: text("applicability_status").notNull().default("pending"),
    assignedOwnerId: text("assigned_owner_id"),
    ownerRole: text("owner_role"),
    priority: text("priority").notNull().default("standard"),
    nextAction: text("next_action"),
    dueDate: text("due_date"),
    escalationDate: text("escalation_date"),
    lastContactDate: text("last_contact_date"),
    expectedResponseDate: text("expected_response_date"),
    businessDate: text("business_date"),
    tagsJson: text("tags_json").notNull().default("[]"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_recovery_cases_invoice").on(table.invoiceReference),
    index("idx_recovery_cases_workspace_client").on(table.workspaceId, table.clientId),
    index("idx_recovery_cases_stage_updated").on(table.stage, table.updatedAt),
  ],
);

export const evidenceDocuments = sqliteTable(
  "evidence_documents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    clientId: text("client_id").notNull().default("local-client"),
    storageKey: text("r2_key").notNull().unique(),
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
    retentionUntil: text("retention_until"),
    quarantinedAt: text("quarantined_at"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_evidence_documents_created").on(table.createdAt), index("idx_evidence_documents_workspace_sha").on(table.workspaceId, table.sha256)],
);

export const evidenceBlobs = sqliteTable(
  "evidence_blobs",
  {
    storageKey: text("storage_key").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sha256: text("sha256").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("idx_evidence_blobs_workspace_sha").on(table.workspaceId, table.sha256)],
);

export const extractedFields = sqliteTable(
  "extracted_fields",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
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
    reviewedByUserId: text("reviewed_by_user_id"),
  },
  (table) => [index("idx_extracted_fields_document").on(table.documentId), uniqueIndex("uq_extracted_fields_workspace_document_field").on(table.workspaceId, table.documentId, table.fieldName)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    caseId: text("case_id"),
    documentId: text("document_id"),
    eventType: text("event_type").notNull(),
    actor: text("actor").notNull(),
    actorUserId: text("actor_user_id"),
    actorDisplayName: text("actor_display_name"),
    actorRole: text("actor_role"),
    detailJson: text("detail_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_audit_events_case_created").on(table.caseId, table.createdAt), index("idx_audit_events_workspace_created").on(table.workspaceId, table.createdAt)],
);

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("pilot-workspace"),
    clientId: text("client_id").notNull().default("local-client"),
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
    idempotencyKey: text("idempotency_key"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextRetryAt: text("next_retry_at"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    providerResponseId: text("provider_response_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostMicros: integer("estimated_cost_micros"),
    requestedByUserId: text("requested_by_user_id"),
  },
  (table) => [
    index("idx_ai_jobs_created").on(table.createdAt),
    index("idx_ai_jobs_task_status").on(table.taskType, table.status),
    index("idx_ai_jobs_case_created").on(table.caseId, table.createdAt),
  ],
);

export const assistantConversations = sqliteTable(
  "assistant_conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    clientId: text("client_id").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default("New conversation"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_assistant_conversations_scope_updated").on(table.workspaceId, table.clientId, table.userId, table.updatedAt)],
);

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: text("conversation_id").notNull().references(() => assistantConversations.id),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    aiJobId: text("ai_job_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_assistant_messages_conversation_id").on(table.conversationId, table.id)],
);

export const ledgerImports = sqliteTable(
  "ledger_imports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    clientId: text("client_id").notNull().default("local-client"),
    sourceType: text("source_type").notNull().default("invoice_payment_ledger"),
    idempotencyKey: text("idempotency_key"),
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
  (table) => [index("idx_ledger_imports_document").on(table.documentId), uniqueIndex("uq_ledger_imports_workspace_client_hash").on(table.workspaceId, table.clientId, table.idempotencyKey)],
);

export const caseSources = sqliteTable(
  "case_sources",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
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
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
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
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    documentId: text("document_id").notNull().references(() => evidenceDocuments.id),
    caseId: text("case_id").notNull().references(() => recoveryCases.id),
    rank: integer("rank").notNull(),
    confidence: integer("confidence").notNull(),
    reasonsJson: text("reasons_json").notNull().default("[]"),
    conflictsJson: text("conflicts_json").notNull().default("[]"),
    status: text("status").notNull().default("suggested"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_candidate_matches_document_rank").on(table.documentId, table.rank), uniqueIndex("uq_candidate_matches_workspace_document_case").on(table.workspaceId, table.documentId, table.caseId), uniqueIndex("uq_candidate_matches_workspace_document_rank").on(table.workspaceId, table.documentId, table.rank)],
);

export const matchExecutions = sqliteTable(
  "match_executions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    caseId: text("case_id").notNull().references(() => recoveryCases.id),
    documentId: text("document_id").notNull().references(() => evidenceDocuments.id),
    ruleVersion: text("rule_version").notNull(),
    resultJson: text("result_json").notNull(),
    factorsJson: text("factors_json").notNull().default("[]"),
    conflictsJson: text("conflicts_json").notNull().default("[]"),
    toleranceJson: text("tolerance_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_match_executions_case_created").on(table.caseId, table.createdAt)],
);

export const recoveryPlans = sqliteTable(
  "recovery_plans",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    caseId: text("case_id").notNull(),
    status: text("status").notNull().default("suggested"),
    planJson: text("plan_json").notNull(),
    aiJobId: text("ai_job_id"),
    reviewerNote: text("reviewer_note"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    acceptedAt: text("accepted_at"),
    acceptedByUserId: text("accepted_by_user_id"),
  },
  (table) => [index("idx_recovery_plans_case_created").on(table.caseId, table.createdAt)],
);

export const communicationDrafts = sqliteTable(
  "communication_drafts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default("local-workspace"),
    caseId: text("case_id").notNull(),
    draftType: text("draft_type").notNull(),
    status: text("status").notNull().default("generated"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    aiJobId: text("ai_job_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    approvedAt: text("approved_at"),
    approvedByUserId: text("approved_by_user_id"),
    copiedAt: text("copied_at"),
    copiedByUserId: text("copied_by_user_id"),
    version: integer("version").notNull().default(1),
    sourceSnapshotJson: text("source_snapshot_json").notNull().default("{}"),
  },
  (table) => [index("idx_communication_drafts_case_created").on(table.caseId, table.createdAt)],
);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  providerSubject: text("provider_subject").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  mode: text("mode").notNull().default("live"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceMemberships = sqliteTable("workspace_memberships", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_memberships_user_workspace").on(table.userId, table.workspaceId), uniqueIndex("uq_memberships_workspace_user").on(table.workspaceId, table.userId)]);

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  entityType: text("entity_type").notNull().default("company"),
  jurisdiction: text("jurisdiction").notNull().default("federal"),
  tin: text("tin").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_clients_workspace").on(table.workspaceId)]);

export const workspaceSettings = sqliteTable("workspace_settings", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  maxFileBytes: integer("max_file_bytes").notNull().default(1_048_576),
  maxStorageBytes: integer("max_storage_bytes").notNull().default(25_000_000),
  retentionDays: integer("retention_days").notNull().default(365),
  defaultClientId: text("default_client_id"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), clientId: text("client_id").notNull(),
  externalReference: text("external_reference"), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(),
  tin: text("tin").notNull().default(""), aliasesJson: text("aliases_json").notNull().default("[]"),
  sourceDocumentId: text("source_document_id"), sourceRow: integer("source_row"), status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_customers_workspace_client").on(table.workspaceId, table.clientId), index("idx_customers_workspace_tin").on(table.workspaceId, table.tin)]);

export const entityTaxIdentities = sqliteTable("entity_tax_identities", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), clientId: text("client_id").notNull(),
  authorityType: text("authority_type").notNull(), jurisdiction: text("jurisdiction").notNull(), tin: text("tin").notNull(),
  legalName: text("legal_name").notNull(), effectiveFrom: text("effective_from"), effectiveTo: text("effective_to"), status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_tax_identities_workspace_client").on(table.workspaceId, table.clientId)]);

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), clientId: text("client_id").notNull(), customerId: text("customer_id").notNull(),
  reference: text("reference").notNull(), correctedReference: text("corrected_reference"), issueDate: text("issue_date"), grossKobo: integer("gross_kobo").notNull(),
  currency: text("currency").notNull().default("NGN"), status: text("status").notNull().default("open"), reversalOfId: text("reversal_of_id"),
  sourceDocumentId: text("source_document_id"), sourceRow: integer("source_row"), sourceIdentity: text("source_identity").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_invoices_workspace_reference").on(table.workspaceId, table.reference), index("idx_invoices_customer").on(table.customerId), uniqueIndex("uq_invoices_workspace_client_source").on(table.workspaceId, table.clientId, table.sourceIdentity)]);

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), clientId: text("client_id").notNull(), customerId: text("customer_id").notNull(),
  reference: text("reference").notNull(), paymentDate: text("payment_date").notNull(), amountKobo: integer("amount_kobo").notNull(), currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("posted"), reversalOfId: text("reversal_of_id"), sourceDocumentId: text("source_document_id"), sourceRow: integer("source_row"), sourceIdentity: text("source_identity").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_payments_workspace_reference").on(table.workspaceId, table.reference), index("idx_payments_customer").on(table.customerId)]);

export const paymentAllocations = sqliteTable("payment_allocations", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), paymentId: text("payment_id").notNull(), invoiceId: text("invoice_id").notNull(),
  amountKobo: integer("amount_kobo").notNull(), status: text("status").notNull().default("confirmed"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_payment_allocations_payment").on(table.paymentId), index("idx_payment_allocations_invoice").on(table.invoiceId)]);

export const applicabilityReviews = sqliteTable("applicability_reviews", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), caseId: text("case_id").notNull(), invoiceId: text("invoice_id"), paymentId: text("payment_id"),
  calculatedGapKobo: integer("calculated_gap_kobo").notNull(), outcome: text("outcome").notNull(), transactionCategory: text("transaction_category").notNull().default(""),
  expectedRateBps: integer("expected_rate_bps"), confirmedExpectedKobo: integer("confirmed_expected_kobo"), exemptionReason: text("exemption_reason"), reviewerNote: text("reviewer_note").notNull(),
  reviewerUserId: text("reviewer_user_id").notNull(), reviewerDisplayName: text("reviewer_display_name").notNull(), ruleVersion: text("rule_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_applicability_case_created").on(table.caseId, table.createdAt)]);

export const receiptRecords = sqliteTable("receipt_records", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), clientId: text("client_id").notNull(), documentId: text("document_id").notNull(),
  receiptReference: text("receipt_reference"), deductingCustomerId: text("deducting_customer_id"), deductingCustomerTin: text("deducting_customer_tin"), beneficiaryTin: text("beneficiary_tin"),
  amountKobo: integer("amount_kobo"), reportingPeriod: text("reporting_period"), receiptDate: text("receipt_date"), status: text("status").notNull().default("review_required"),
  extractionReviewedAt: text("extraction_reviewed_at"), extractionReviewedBy: text("extraction_reviewed_by"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_receipts_workspace_reference").on(table.workspaceId, table.receiptReference), uniqueIndex("uq_receipts_workspace_document").on(table.workspaceId, table.documentId)]);

export const receiptAllocations = sqliteTable("receipt_allocations", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), receiptId: text("receipt_id").notNull(), caseId: text("case_id").notNull(), invoiceId: text("invoice_id"),
  amountKobo: integer("amount_kobo").notNull(), status: text("status").notNull().default("confirmed"), confirmedByUserId: text("confirmed_by_user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_receipt_allocations_receipt").on(table.receiptId), index("idx_receipt_allocations_case").on(table.caseId)]);

export const authorityRecords = sqliteTable("authority_records", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), clientId: text("client_id").notNull(), documentId: text("document_id"),
  authorityType: text("authority_type").notNull(), jurisdiction: text("jurisdiction").notNull(), recordReference: text("record_reference").notNull(), beneficiaryTin: text("beneficiary_tin").notNull(),
  deductingCustomerTin: text("deducting_customer_tin").notNull(), amountKobo: integer("amount_kobo").notNull(), reportingPeriod: text("reporting_period").notNull(), filingDate: text("filing_date"),
  creditStatus: text("credit_status").notNull(), verificationState: text("verification_state").notNull().default("unverified"), sourceRow: integer("source_row"),
  verifiedByUserId: text("verified_by_user_id"), verifiedAt: text("verified_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_authority_workspace_reference").on(table.workspaceId, table.recordReference), uniqueIndex("uq_authority_workspace_client_identity").on(table.workspaceId, table.clientId, table.authorityType, table.recordReference)]);

export const authorityAllocations = sqliteTable("authority_allocations", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), authorityRecordId: text("authority_record_id").notNull(), caseId: text("case_id").notNull(), receiptAllocationId: text("receipt_allocation_id"),
  matchExecutionId: text("match_execution_id"),
  amountKobo: integer("amount_kobo").notNull(), resultCode: text("result_code").notNull(), resultJson: text("result_json").notNull(), ruleVersion: text("rule_version").notNull(),
  verifiedByUserId: text("verified_by_user_id").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_authority_allocations_case").on(table.caseId),
  index("idx_authority_allocations_record").on(table.authorityRecordId),
  uniqueIndex("uq_authority_successful_receipt").on(table.workspaceId, table.authorityRecordId, table.receiptAllocationId).where(sql`${table.resultCode} IN ('matched','matched_within_tolerance')`),
]);

export const correspondenceEvents = sqliteTable("correspondence_events", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), caseId: text("case_id").notNull(), draftId: text("draft_id"), direction: text("direction").notNull(),
  channel: text("channel").notNull(), eventType: text("event_type").notNull(), subject: text("subject"), body: text("body"), occurredAt: text("occurred_at").notNull(),
  recordedByUserId: text("recorded_by_user_id").notNull(), sourceDocumentId: text("source_document_id"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_correspondence_case_occurred").on(table.caseId, table.occurredAt)]);

export const caseOutcomes = sqliteTable("case_outcomes", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), caseId: text("case_id").notNull(), outcomeType: text("outcome_type").notNull(),
  amountKobo: integer("amount_kobo").notNull(), effectiveDate: text("effective_date").notNull(), reviewerUserId: text("reviewer_user_id").notNull(), approverUserId: text("approver_user_id"),
  evidenceDocumentId: text("evidence_document_id"), decisionNote: text("decision_note").notNull(), ruleVersion: text("rule_version").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_case_outcomes_case_effective").on(table.caseId, table.effectiveDate), uniqueIndex("uq_case_outcomes_workspace_case").on(table.workspaceId, table.caseId)]);

export const caseNotes = sqliteTable("case_notes", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), caseId: text("case_id").notNull(), body: text("body").notNull(),
  createdByUserId: text("created_by_user_id").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), deletedAt: text("deleted_at"),
}, (table) => [index("idx_case_notes_case_created").on(table.caseId, table.createdAt)]);

export const caseChecklistItems = sqliteTable("case_checklist_items", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), caseId: text("case_id").notNull(), label: text("label").notNull(),
  status: text("status").notNull().default("open"), completedByUserId: text("completed_by_user_id"), completedAt: text("completed_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_case_checklist_case").on(table.caseId)]);

export const ruleSets = sqliteTable("rule_sets", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), version: text("version").notNull(), status: text("status").notNull(),
  effectiveStart: text("effective_start").notNull(), effectiveEnd: text("effective_end"), clientId: text("client_id"), jurisdiction: text("jurisdiction"),
  tolerancesJson: text("tolerances_json").notNull().default("{}"), applicabilityCategoriesJson: text("applicability_categories_json").notNull().default("[]"),
  practitionerNotes: text("practitioner_notes").notNull().default(""), changeReason: text("change_reason").notNull(), approvedByUserId: text("approved_by_user_id"), approvedAt: text("approved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_rule_sets_workspace_status").on(table.workspaceId, table.status),
  uniqueIndex("uq_rule_sets_workspace_version_client").on(table.workspaceId, table.version, table.clientId),
  uniqueIndex("uq_rule_sets_workspace_version_global").on(table.workspaceId, table.version).where(sql`${table.clientId} IS NULL`),
]);

export const ruleDefinitions = sqliteTable("rule_definitions", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), ruleSetId: text("rule_set_id").notNull(), ruleCode: text("rule_code").notNull(),
  definitionJson: text("definition_json").notNull(), practitionerNote: text("practitioner_note"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_rule_definitions_set").on(table.ruleSetId)]);

export const ruleApprovals = sqliteTable("rule_approvals", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), ruleSetId: text("rule_set_id").notNull(), approverUserId: text("approver_user_id").notNull(),
  role: text("role").notNull(), decision: text("decision").notNull(), note: text("note").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_rule_approvals_set").on(table.ruleSetId)]);

export const ruleChangeHistory = sqliteTable("rule_change_history", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), ruleSetId: text("rule_set_id").notNull(), changeType: text("change_type").notNull(),
  beforeJson: text("before_json"), afterJson: text("after_json").notNull(), changedByUserId: text("changed_by_user_id").notNull(), reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_rule_history_set_created").on(table.ruleSetId, table.createdAt)]);

export const auditPacks = sqliteTable("audit_packs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull(), caseId: text("case_id").notNull(), format: text("format").notNull(),
  snapshotJson: text("snapshot_json").notNull(), manifestJson: text("manifest_json").notNull(), generatedByUserId: text("generated_by_user_id").notNull(),
  generatedAt: text("generated_at").notNull(), snapshotHash: text("snapshot_hash").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_audit_packs_case_generated").on(table.caseId, table.generatedAt)]);

export const rateLimitBuckets = sqliteTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(), windowStartedAt: text("window_started_at").notNull(), requestCount: integer("request_count").notNull().default(0),
});
