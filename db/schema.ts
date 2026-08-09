// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
export {};
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
